/**
 * Fila `pano.process` (Redis + BullMQ), no contrato de workers/processing/contract.md.
 *
 * O Node só faz duas coisas aqui: enfileira o job quando o upload do panorama
 * termina, e grava o resultado que o worker devolve. Todo o processamento de
 * imagem (horizonte, nadir, rostos/LGPD, preview, tiles) é do worker Python —
 * OpenCV e pyvips não entram no Node.
 *
 * O resultado chega por dois caminhos, e gravar é idempotente:
 *   — o valor de retorno do job (evento `completed` do BullMQ) — durável;
 *   — o canal `pano.process.result`, que o contrato define para outros consumidores.
 * O progresso vem do canal `job.progress`, que o worker já publica.
 */
import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import type { Sb } from "../db/supabase.ts";
import { ok } from "../db/supabase.ts";

export const QUEUE = "pano.process";
export const RESULT_CHANNEL = "pano.process.result";
export const PROGRESS_CHANNEL = "job.progress";
/** "3 tentativas com backoff exponencial" — contract.md, idempotência e falha */
export const ATTEMPTS = 3;

/** Payload do job, exatamente como no contrato. */
export interface PanoJob {
  job_id: string;
  panorama_id: string;
  capture_id: string;
  org_id: string;
  storage_key: string;
  options: {
    nadir_patch: boolean;
    blur_faces: boolean;
    horizon_stabilize: boolean;
    tile_format: "avif" | "webp" | "jpg";
    preview_width: number;
    tile_size: number;
    max_level: number;
  };
}

/** Resultado publicado pelo worker (contract.md). Campos extras são ignorados. */
export const PanoResult = z.object({
  job_id: z.string(),
  panorama_id: z.string().uuid(),
  status: z.enum(["done", "failed"]),
  preview_key: z.string().optional(),
  tiles_key: z.string().optional(),
  width_px: z.number().int().optional(),
  height_px: z.number().int().optional(),
  nadir_patched: z.boolean().optional(),
  faces_blurred: z.boolean().optional(),
  faces_found: z.number().int().optional(),
  timings_ms: z.record(z.string(), z.number()).optional(),
  error: z.string().optional(),
});
export type PanoResult = z.infer<typeof PanoResult>;

/**
 * Grava o resultado no panorama e recalcula a captura. Usa a secret key:
 * é o sistema registrando o que o worker fez, não um usuário — e a policy
 * impede usuário de editar panorama de captura concluída.
 */
export async function persistResult(admin: Sb, raw: unknown): Promise<void> {
  const r = PanoResult.parse(raw);
  if (r.status === "done") {
    ok(await admin.from("panoramas").update({
      processing_status: "done",
      preview_key: r.preview_key ?? null,
      tiles_key: r.tiles_key ?? null,
      width_px: r.width_px ?? null,
      height_px: r.height_px ?? null,
      nadir_patched: r.nadir_patched ?? undefined,
      faces_blurred: r.faces_blurred ?? undefined,
      faces_found: r.faces_found ?? null,
      timings_ms: r.timings_ms ?? null,
      processing_error: null,
      processed_at: new Date().toISOString(),
    }).eq("id", r.panorama_id));
  } else {
    ok(await admin.from("panoramas").update({
      processing_status: "failed",
      processing_error: r.error ?? "falha no processamento",
      processed_at: new Date().toISOString(),
    }).eq("id", r.panorama_id).neq("processing_status", "done"));
  }
  ok(await admin.rpc("refresh_capture", { p_panorama: r.panorama_id }));
}

export interface PanoQueue {
  enqueue(job: PanoJob): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export function createPanoQueue(
  redisUrl: string,
  admin: Sb,
  log: { info: (m: string) => void; warn: (m: string) => void },
): PanoQueue {
  // BullMQ exige maxRetriesPerRequest nulo nas conexões que bloqueiam
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  let avisado = false;
  connection.on("error", (err) => {
    if (!avisado) log.warn(`[fila] Redis indisponível (${err.message}); uploads de panorama ficam recusados`);
    avisado = true;
  });
  connection.on("ready", () => {
    avisado = false;
    log.info(`[fila] conectado ao Redis — fila ${QUEUE}`);
  });

  const queue = new Queue<PanoJob>(QUEUE, { connection });
  const events = new QueueEvents(QUEUE, { connection: connection.duplicate() });
  const sub = connection.duplicate();

  const gravar = (raw: unknown, origem: string) =>
    persistResult(admin, raw).catch((err) => log.warn(`[fila] resultado inválido (${origem}): ${String(err)}`));

  events.on("completed", ({ returnvalue }) => {
    const value = typeof returnvalue === "string" ? safeJson(returnvalue) : returnvalue;
    void gravar(value, "completed");
  });

  // `failed` também dispara entre tentativas; só a falha definitiva vira estado
  events.on("failed", async ({ jobId, failedReason }) => {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const state = await job.getState();
    if (state !== "failed") return;
    void gravar(
      { job_id: jobId, panorama_id: job.data.panorama_id, status: "failed", error: failedReason },
      "failed",
    );
  });

  void sub.subscribe(RESULT_CHANNEL, PROGRESS_CHANNEL);
  sub.on("message", (channel, message) => {
    const data = safeJson(message);
    if (!data || typeof data !== "object") return;
    if (channel === RESULT_CHANNEL) {
      void gravar(data, RESULT_CHANNEL);
      return;
    }
    const p = data as { job_id?: string; progress_pct?: number };
    if (!p.job_id || typeof p.progress_pct !== "number") return;
    void admin
      .from("panoramas")
      .update({ processing_status: "processing" })
      .eq("job_id", p.job_id)
      .in("processing_status", ["queued", "uploading"])
      .then(() => undefined, () => undefined);
  });

  return {
    async enqueue(job) {
      await queue.add(QUEUE, job, {
        jobId: job.job_id,
        attempts: ATTEMPTS,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 7 * 86_400 },
        removeOnFail: false,
      });
    },
    async ping() {
      return connection.status === "ready" && (await connection.ping().then(() => true, () => false));
    },
    async close() {
      await Promise.allSettled([events.close(), queue.close(), sub.quit(), connection.quit()]);
    },
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
