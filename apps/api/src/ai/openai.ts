/**
 * A IA da obra, atrás da API.
 *
 * A chave da OpenAI vive só aqui (OPENAI_API_KEY no ambiente do Node) —
 * nunca no bundle do navegador. O cliente manda a imagem e recebe o texto.
 * Sem chave, a resposta sai simulada e marcada como tal.
 */
import OpenAI from "openai";
import type { Config } from "../config.ts";
import { HttpError } from "../lib/errors.ts";
import type { ImageMedia } from "../storage.ts";
import * as P from "./prompts.ts";

export interface AiImage {
  mediaType: ImageMedia;
  data: Buffer;
}

export interface AiText {
  text: string;
  simulated: boolean;
  model: string | null;
}

export interface NcSuggestion {
  titulo: string;
  descricao: string;
  disciplina: string;
  severidade: "baixa" | "media" | "alta" | "critica";
  norma?: string;
  local?: string;
  confianca: "alta" | "media" | "baixa";
  verificavel: boolean;
}

export interface RdoDraft {
  servicesExecuted: string;
  occurrences: string;
  nonConformities: string;
  notes: string;
  simulated: boolean;
  model: string | null;
}

type Part =
  | { type: "text"; text: string }
  | { type: "image"; image: AiImage };

/** Extrai o objeto JSON da resposta, tolerando cercas de código ao redor. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toContent(parts: Part[]): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
  return parts.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : {
          type: "image_url",
          image_url: { url: `data:${part.image.mediaType};base64,${part.image.data.toString("base64")}` },
        },
  );
}

export class Ai {
  private readonly client: OpenAI | null;

  constructor(private readonly cfg: Pick<Config, "OPENAI_API_KEY" | "OPENAI_MODEL">) {
    this.client = cfg.OPENAI_API_KEY ? new OpenAI({ apiKey: cfg.OPENAI_API_KEY }) : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  get model(): string {
    return this.cfg.OPENAI_MODEL;
  }

  private async run(system: string, parts: Part[], onText?: (delta: string) => void): Promise<{ text: string; model: string }> {
    const client = this.client!;
    try {
      const stream = await client.chat.completions.create({
        model: this.cfg.OPENAI_MODEL,
        max_tokens: 8000,
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: toContent(parts) },
        ],
      });
      let text = "";
      let model = this.cfg.OPENAI_MODEL;
      for await (const chunk of stream) {
        if (chunk.model) model = chunk.model;
        const choice = chunk.choices[0];
        if (choice?.finish_reason === "content_filter") {
          throw new HttpError(422, "ia_recusou", "A IA recusou analisar este conteúdo. Registre a análise manualmente.");
        }
        const delta = choice?.delta?.content ?? "";
        if (!delta) continue;
        text += delta;
        onText?.(delta);
      }
      return { text: text.trim(), model };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof OpenAI.AuthenticationError) {
        throw new HttpError(502, "ia_indisponivel", "A chave da OpenAI configurada no servidor foi recusada.");
      }
      if (err instanceof OpenAI.RateLimitError) {
        const semCredito = err.code === "credit_balance_exhausted" || err.type === "insufficient_quota";
        throw new HttpError(
          503,
          semCredito ? "ia_sem_credito" : "ia_ocupada",
          semCredito
            ? "A conta da OpenAI está sem créditos. Adicione créditos no painel da OpenAI para a análise real."
            : "A IA está com limite de uso atingido. Tente de novo em instantes.",
        );
      }
      if (err instanceof OpenAI.BadRequestError) {
        throw new HttpError(422, "ia_requisicao", `A IA não aceitou a requisição: ${err.message}`);
      }
      if (err instanceof OpenAI.APIError) {
        throw new HttpError(502, "ia_indisponivel", `Falha na IA (${err.status ?? "rede"}). Tente de novo.`);
      }
      throw err;
    }
  }

  /** Análise de uma vista 360 (viewer). */
  async analyzeView(img: AiImage, question: string): Promise<AiText> {
    if (!this.client) return { text: P.simulatedView(question), simulated: true, model: null };
    const r = await this.run(P.VIEW_SYSTEM, [
      { type: "image", image: img },
      { type: "text", text: question || "Analise esta vista da obra." },
    ]);
    return { text: r.text || "(resposta vazia)", simulated: false, model: r.model };
  }

  /** Observação de uma frente da visita — lê o conjunto de fotos (até 6). */
  async observeStop(imgs: AiImage[], ctx: { project: string; label: string }): Promise<AiText> {
    if (!this.client) return { text: P.simulatedStop(ctx.label), simulated: true, model: null };
    const fotos = imgs.slice(0, 6);
    const parts: Part[] = [];
    fotos.forEach((img, i) => {
      if (fotos.length > 1) parts.push({ type: "text", text: `Foto ${i + 1}:` });
      parts.push({ type: "image", image: img });
    });
    parts.push({
      type: "text",
      text:
        `Obra: ${ctx.project}. Frente de serviço: ${ctx.label}. ` +
        (fotos.length > 1 ? `São ${fotos.length} fotos da mesma frente — descreva o conjunto.` : ""),
    });
    const r = await this.run(P.STOP_SYSTEM, parts);
    return { text: r.text || "(sem retorno do modelo)", simulated: false, model: r.model };
  }

  /** Leitura da planta baixa, com os deltas repassados enquanto o texto é escrito. */
  async analyzeFloorplan(
    img: AiImage,
    ctx: { project: string; plan: string },
    onDelta?: (delta: string) => void,
  ): Promise<AiText> {
    if (!this.client) {
      const text = P.simulatedPlan(ctx.project, ctx.plan);
      onDelta?.(text);
      return { text, simulated: true, model: null };
    }
    const r = await this.run(
      P.PLAN_SYSTEM,
      [
        { type: "image", image: img },
        { type: "text", text: `Obra: ${ctx.project}. Planta: ${ctx.plan}.` },
      ],
      onDelta,
    );
    return { text: r.text || "(resposta vazia)", simulated: false, model: r.model };
  }

  /** Rascunho dos campos de relato do RDO a partir das vistas da visita. */
  async draftRdo(
    sources: { image: AiImage; previousAnalysis?: string; label?: string }[],
    ctx: { project: string; date: string; levels: string; openIssues: string[] },
  ): Promise<RdoDraft> {
    if (!this.client || sources.length === 0) {
      return { ...P.simulatedRdo(ctx.project, ctx.date), simulated: true, model: null };
    }
    const parts: Part[] = [];
    sources.slice(0, 8).forEach((src, i) => {
      parts.push({ type: "text", text: `Ponto ${i + 1}${src.label ? ` — ${src.label}` : ""} do registro 360°:` });
      parts.push({ type: "image", image: src.image });
      if (src.previousAnalysis) {
        parts.push({ type: "text", text: `Análise já registrada para esta vista:\n${src.previousAnalysis.slice(0, 1500)}` });
      }
    });
    parts.push({
      type: "text",
      text: [
        `Obra: ${ctx.project}`,
        `Data da visita: ${ctx.date}`,
        `Frentes cobertas: ${ctx.levels}`,
        ctx.openIssues.length
          ? `Pendências já abertas nesta obra (cite apenas as que o registro visual confirmar): ${ctx.openIssues.join("; ")}`
          : "Não há pendências abertas registradas.",
        "",
        "Redija os campos do RDO a partir deste registro.",
      ].join("\n"),
    });
    const r = await this.run(P.RDO_SYSTEM, parts);
    const parsed = parseJsonObject(r.text);
    if (!parsed) {
      return { servicesExecuted: "", occurrences: "", nonConformities: "", notes: r.text, simulated: false, model: r.model };
    }
    return {
      servicesExecuted: String(parsed.servicos_executados ?? ""),
      occurrences: String(parsed.ocorrencias ?? ""),
      nonConformities: String(parsed.nao_conformidades ?? ""),
      notes: String(parsed.observacoes ?? ""),
      simulated: false,
      model: r.model,
    };
  }

  /** Triagem: candidatas a NC para aceite humano. A IA nunca abre a peça. */
  async triage(
    img: AiImage,
    ctx: { project: string; level: string },
  ): Promise<{ itens: NcSuggestion[]; simulated: boolean; model: string | null; raw: string }> {
    if (!this.client) {
      const itens = P.simulatedTriagem(ctx.level);
      return { itens, simulated: true, model: null, raw: JSON.stringify({ itens }) };
    }
    const r = await this.run(P.TRIAGEM_SYSTEM, [
      { type: "image", image: img },
      { type: "text", text: `Obra: ${ctx.project}. Frente: ${ctx.level}. Aponte as candidatas a não conformidade.` },
    ]);
    const obj = parseJsonObject(r.text);
    const itens = Array.isArray(obj?.itens) ? (obj.itens as NcSuggestion[]) : [];
    return { itens: itens.filter((i) => i && i.titulo).slice(0, 6), simulated: false, model: r.model, raw: r.text };
  }
}
