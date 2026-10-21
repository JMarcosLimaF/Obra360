/**
 * O acervo de imagens que a obra já produziu.
 *
 * Quando o fiscal abre uma não conformidade, quase sempre a foto do problema já
 * existe: ele acabou de fotografar aquela frente na visita, ou analisou aquela
 * vista no tour meia hora antes. Obrigá-lo a fotografar de novo é retrabalho — e
 * pior, produz duas imagens do mesmo defeito em horários diferentes, que é
 * exatamente o tipo de inconsistência que atrapalha numa auditoria.
 *
 * Aqui as fontes viram uma lista só, preservando o que cada uma já sabia: a
 * legenda escrita em campo, o pavimento da frente e a vista do tour de onde a
 * imagem saiu.
 */
import type { AiAnalysis, Rdo, TourPose } from "../types";
import { RDO_PHOTO_KIND_LABEL } from "../types";

export interface FotoDoAcervo {
  id: string;
  imageDataUrl: string;
  pose?: TourPose;
  /** legenda escrita por quem fotografou, quando houver */
  caption: string;
  /** de onde a imagem veio, em uma linha legível */
  origem: string;
  createdAt: string;
  levelId?: string;
  /** id do RDO de origem, para priorizar as fotos da visita corrente */
  rdoId?: string;
}

export function acervoDeFotos(
  projectId: string,
  rdos: Rdo[],
  analyses: AiAnalysis[],
): FotoDoAcervo[] {
  const fotos: FotoDoAcervo[] = [];

  for (const rdo of rdos.filter((r) => r.projectId === projectId)) {
    for (const stop of rdo.stops) {
      for (const p of stop.photos) {
        if (!p.imageDataUrl) continue;
        fotos.push({
          id: p.id,
          imageDataUrl: p.imageDataUrl,
          pose: p.pose,
          caption: p.caption,
          origem:
            `Visita RDO nº ${String(rdo.number).padStart(3, "0")} · ${stop.label}` +
            ` · ${RDO_PHOTO_KIND_LABEL[p.kind]}`,
          createdAt: p.createdAt,
          levelId: stop.levelId,
          rdoId: rdo.id,
        });
      }
    }
  }

  for (const a of analyses.filter((x) => x.projectId === projectId)) {
    if (!a.imageDataUrl) continue;
    fotos.push({
      id: a.id,
      imageDataUrl: a.imageDataUrl,
      caption: a.question,
      origem: `Análise 360 · ${new Date(a.createdAt).toLocaleDateString("pt-BR")}`,
      createdAt: a.createdAt,
    });
  }

  return fotos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Põe na frente o que provavelmente é a foto certa: mesma visita, mesmo pavimento. */
export function priorizar(
  fotos: FotoDoAcervo[],
  hint: { rdoId?: string; levelId?: string },
): FotoDoAcervo[] {
  const peso = (f: FotoDoAcervo) =>
    (hint.rdoId && f.rdoId === hint.rdoId ? 0 : 2) + (hint.levelId && f.levelId === hint.levelId ? 0 : 1);
  return [...fotos].sort((a, b) => peso(a) - peso(b) || b.createdAt.localeCompare(a.createdAt));
}
