/**
 * IA da obra, chamada pela API Node.
 *
 * A chave da Anthropic não entra no navegador. Sem chave no servidor, a API
 * devolve texto marcado como simulado — a tela continua demonstrável.
 */
import { api } from "../api/client";

export interface AnalysisResult {
  text: string;
  simulated: boolean;
}

export interface RdoDraft {
  servicesExecuted: string;
  occurrences: string;
  nonConformities: string;
  notes: string;
  simulated: boolean;
}

export interface RdoSource {
  imageDataUrl: string;
  previousAnalysis?: string;
  label?: string;
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

export interface TriagemResult {
  itens: NcSuggestion[];
  simulated: boolean;
}

export function analyzeView(image: string, question: string, projectId = ""): Promise<AnalysisResult> {
  return api("/api/ai/view", { method: "POST", body: JSON.stringify({ image, question, projectId }) });
}

export function observeStop(
  images: string[],
  context: { project: string; label: string; projectId?: string },
): Promise<{ text: string; simulated: boolean }> {
  return api("/api/ai/stop", {
    method: "POST",
    body: JSON.stringify({ images, project: context.project, label: context.label, projectId: context.projectId ?? "" }),
  });
}

export async function analyzeFloorplan(
  image: string,
  context: { project: string; plan: string; projectId?: string },
  onDelta?: (partial: string) => void,
): Promise<AnalysisResult> {
  const result = await api<AnalysisResult>("/api/ai/floorplan", {
    method: "POST",
    body: JSON.stringify({ image, project: context.project, plan: context.plan, projectId: context.projectId ?? "" }),
  });
  onDelta?.(result.text);
  return result;
}

export function draftRdo(
  sources: RdoSource[],
  context: { project: string; date: string; levels: string; openIssues: string[]; projectId?: string },
): Promise<RdoDraft> {
  return api("/api/ai/rdo", {
    method: "POST",
    body: JSON.stringify({
      projectId: context.projectId ?? "",
      project: context.project,
      date: context.date,
      levels: context.levels,
      openIssues: context.openIssues,
      sources: sources.map((s) => ({
        image: s.imageDataUrl,
        previousAnalysis: s.previousAnalysis,
        label: s.label,
      })),
    }),
  });
}

export function suggestInconsistencies(
  image: string,
  context: { project: string; level: string; projectId?: string },
): Promise<TriagemResult> {
  return api("/api/ai/triage", {
    method: "POST",
    body: JSON.stringify({
      image,
      project: context.project,
      level: context.level,
      projectId: context.projectId ?? "",
    }),
  });
}
