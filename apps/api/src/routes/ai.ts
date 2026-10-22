/**
 * A chave da OpenAI fica neste processo. O navegador manda a imagem e
 * recebe o texto; se não houver chave, a resposta vem marcada como simulada.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { authenticate } from "../auth/session.ts";
import { userClient } from "../db/supabase.ts";
import { badRequest } from "../lib/errors.ts";
import { projectAccess, requireWriter } from "../services/access.ts";
import { parseDataUrl } from "../storage.ts";

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: authenticate(app) };

  app.post("/api/ai/view", guard, async (req) => {
    const b = body(req.body);
    const img = imageOf(b.image);
    await assertWriter(app, req, str(b.projectId));
    return app.ctx.ai.analyzeView(img, str(b.question));
  });

  app.post("/api/ai/stop", guard, async (req) => {
    const b = body(req.body);
    const images = Array.isArray(b.images) ? b.images.map((src) => imageOf(src)) : [];
    if (images.length === 0) throw badRequest("Envie ao menos uma foto da frente.");
    await assertWriter(app, req, str(b.projectId));
    return app.ctx.ai.observeStop(images, { project: str(b.project), label: str(b.label) });
  });

  app.post("/api/ai/floorplan", guard, async (req) => {
    const b = body(req.body);
    const img = imageOf(b.image);
    await assertWriter(app, req, str(b.projectId));
    return app.ctx.ai.analyzeFloorplan(img, { project: str(b.project), plan: str(b.plan) });
  });

  app.post("/api/ai/rdo", guard, async (req) => {
    const b = body(req.body);
    const sources = Array.isArray(b.sources) ? b.sources : [];
    await assertWriter(app, req, str(b.projectId));
    const prepared = sources.slice(0, 8).map((src) => {
      const row = (src ?? {}) as Record<string, unknown>;
      return {
        image: imageOf(row.image),
        previousAnalysis: typeof row.previousAnalysis === "string" ? row.previousAnalysis : undefined,
        label: typeof row.label === "string" ? row.label : undefined,
      };
    });
    return app.ctx.ai.draftRdo(prepared, {
      project: str(b.project),
      date: str(b.date),
      levels: str(b.levels),
      openIssues: Array.isArray(b.openIssues) ? b.openIssues.filter((x): x is string => typeof x === "string") : [],
    });
  });

  app.post("/api/ai/triage", guard, async (req) => {
    const b = body(req.body);
    const img = imageOf(b.image);
    await assertWriter(app, req, str(b.projectId));
    const r = await app.ctx.ai.triage(img, { project: str(b.project), level: str(b.level) });
    return { itens: r.itens, simulated: r.simulated };
  });
}

async function assertWriter(app: FastifyInstance, req: FastifyRequest, projectId: string) {
  if (!projectId) throw badRequest("Informe a obra.");
  const access = await projectAccess(userClient(app.ctx.cfg, req.accessToken), req, projectId);
  requireWriter(access);
}

function imageOf(ref: unknown) {
  const parsed = parseDataUrl(typeof ref === "string" ? ref : "");
  if (!parsed) throw badRequest("Imagem em formato não reconhecido.");
  return parsed;
}

const body = (v: unknown) => (v ?? {}) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
