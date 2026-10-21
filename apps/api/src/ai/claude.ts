/**
 * A IA da obra, atrás da API.
 *
 * A chave da Anthropic vive só aqui (ANTHROPIC_API_KEY no ambiente do Node) —
 * nunca no bundle do navegador, nunca em localStorage. O cliente manda a imagem
 * (ou a referência a uma que a API já guardou) e recebe o texto.
 *
 * Todas as chamadas usam streaming com `finalMessage()`: ler uma prancha inteira
 * leva minutos, e streaming evita estourar o timeout HTTP; na planta, os deltas
 * ainda vão sendo repassados à tela. O pensamento adaptativo do modelo é
 * sempre ligado; o esforço é configurável (ANTHROPIC_EFFORT).
 *
 * Fallback no servidor (`fallbacks: "default"`): se o modelo principal recusar
 * por política, a própria API da Anthropic refaz a chamada noutro modelo. Se a
 * cadeia inteira recusar, devolvemos um erro claro — nunca texto vazio.
 */
import Anthropic from "@anthropic-ai/sdk";
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

const image = (img: AiImage): Anthropic.Beta.BetaImageBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: img.mediaType, data: img.data.toString("base64") },
});

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

export class Ai {
  private readonly client: Anthropic | null;

  constructor(private readonly cfg: Pick<Config, "ANTHROPIC_API_KEY" | "ANTHROPIC_MODEL" | "ANTHROPIC_EFFORT">) {
    this.client = cfg.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY }) : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  get model(): string {
    return this.cfg.ANTHROPIC_MODEL;
  }

  private async run(
    system: string,
    content: Anthropic.Beta.BetaContentBlockParam[],
    onText?: (delta: string) => void,
  ): Promise<{ text: string; model: string }> {
    const client = this.client!;
    try {
      const stream = client.beta.messages.stream({
        model: this.cfg.ANTHROPIC_MODEL,
        max_tokens: 16000,
        system,
        output_config: { effort: this.cfg.ANTHROPIC_EFFORT },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content }],
      });
      if (onText) stream.on("text", onText);
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") {
        throw new HttpError(422, "ia_recusou", "A IA recusou analisar este conteúdo. Registre a análise manualmente.");
      }
      const text = msg.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { text, model: msg.model };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof Anthropic.AuthenticationError) {
        throw new HttpError(502, "ia_indisponivel", "A chave da Anthropic configurada no servidor foi recusada.");
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new HttpError(503, "ia_ocupada", "A IA está com limite de uso atingido. Tente de novo em instantes.");
      }
      if (err instanceof Anthropic.BadRequestError) {
        throw new HttpError(422, "ia_requisicao", `A IA não aceitou a requisição: ${err.message}`);
      }
      if (err instanceof Anthropic.APIError) {
        throw new HttpError(502, "ia_indisponivel", `Falha na IA (${err.status ?? "rede"}). Tente de novo.`);
      }
      throw err;
    }
  }

  /** Análise de uma vista 360 (viewer). */
  async analyzeView(img: AiImage, question: string): Promise<AiText> {
    if (!this.client) return { text: P.simulatedView(question), simulated: true, model: null };
    const r = await this.run(P.VIEW_SYSTEM, [image(img), { type: "text", text: question || "Analise esta vista da obra." }]);
    return { text: r.text || "(resposta vazia)", simulated: false, model: r.model };
  }

  /** Observação de uma frente da visita — lê o conjunto de fotos (até 6). */
  async observeStop(imgs: AiImage[], ctx: { project: string; label: string }): Promise<AiText> {
    if (!this.client) return { text: P.simulatedStop(ctx.label), simulated: true, model: null };
    const fotos = imgs.slice(0, 6);
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    fotos.forEach((img, i) => {
      if (fotos.length > 1) content.push({ type: "text", text: `Foto ${i + 1}:` });
      content.push(image(img));
    });
    content.push({
      type: "text",
      text:
        `Obra: ${ctx.project}. Frente de serviço: ${ctx.label}. ` +
        (fotos.length > 1 ? `São ${fotos.length} fotos da mesma frente — descreva o conjunto.` : ""),
    });
    const r = await this.run(P.STOP_SYSTEM, content);
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
      [image(img), { type: "text", text: `Obra: ${ctx.project}. Planta: ${ctx.plan}.` }],
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
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    sources.slice(0, 8).forEach((src, i) => {
      content.push({ type: "text", text: `Ponto ${i + 1}${src.label ? ` — ${src.label}` : ""} do registro 360°:` });
      content.push(image(src.image));
      if (src.previousAnalysis) {
        content.push({ type: "text", text: `Análise já registrada para esta vista:\n${src.previousAnalysis.slice(0, 1500)}` });
      }
    });
    content.push({
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
    const r = await this.run(P.RDO_SYSTEM, content);
    const parsed = parseJsonObject(r.text);
    if (!parsed) {
      // fora do formato: aproveita o texto como observações em vez de perdê-lo
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
      image(img),
      { type: "text", text: `Obra: ${ctx.project}. Frente: ${ctx.level}. Aponte as candidatas a não conformidade.` },
    ]);
    const obj = parseJsonObject(r.text);
    const itens = Array.isArray(obj?.itens) ? (obj!.itens as NcSuggestion[]) : [];
    return { itens: itens.filter((i) => i && i.titulo).slice(0, 6), simulated: false, model: r.model, raw: r.text };
  }
}
