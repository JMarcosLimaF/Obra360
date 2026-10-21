/**
 * A costura entre os módulos.
 *
 * Cada tela sozinha registra um pedaço da obra: a planta diz o que deveria
 * existir, o tour mostra o que existe, o diário conta o que aconteceu no dia e
 * a pendência cobra o que falta. O que liga tudo é o **pavimento**. Aqui ficam
 * as consultas que atravessam os módulos, para o painel e o relatório contarem
 * a mesma história — e para a pendência saber voltar à sua origem.
 */
import { caminhoDaObra } from "../obra";
import type { Floorplan, Issue, Level, Rdo, RdoPhoto, RdoStop } from "../types";

export const TODAY = "2026-08-30";

/** Situação consolidada de um pavimento, atravessando os quatro módulos. */
export interface LevelStatus {
  level: Level;
  plan?: Floorplan;
  planRead: boolean;
  pins: number;
  issues: Issue[];
  open: Issue[];
  overdue: Issue[];
  critical: Issue[];
  lastVisit?: { rdo: Rdo; stop: RdoStop };
  photos: RdoPhoto[];
}

export function levelStatuses(
  levels: Level[],
  floorplans: Floorplan[],
  issues: Issue[],
  rdos: Rdo[],
): LevelStatus[] {
  const ordered = [...rdos].sort((a, b) => b.date.localeCompare(a.date));

  return levels.map((level) => {
    const plan = floorplans.find((f) => f.levelId === level.id);
    const mine = issues.filter((i) => i.levelId === level.id);
    const open = mine.filter((i) => i.status !== "resolvido");

    let lastVisit: LevelStatus["lastVisit"];
    const photos: RdoPhoto[] = [];
    for (const rdo of ordered) {
      for (const stop of rdo.stops) {
        if (stop.levelId !== level.id) continue;
        if (!lastVisit) lastVisit = { rdo, stop };
        photos.push(...stop.photos);
      }
    }

    return {
      level,
      plan,
      planRead: Boolean(plan?.analysis),
      pins: plan?.pins.length ?? 0,
      issues: mine,
      open,
      overdue: open.filter((i) => i.dueDate < TODAY),
      critical: open.filter((i) => i.severity === "critica"),
      lastVisit,
      photos,
    };
  });
}

/** Pendências que ninguém amarrou a um pavimento — ficam de fora do consolidado. */
export const unleveled = (issues: Issue[]) => issues.filter((i) => !i.levelId);

/** Caminhos de volta à origem de uma pendência. */
export interface Trail {
  to: string;
  label: string;
  /** pede à tela de destino que voe até a pendência */
  fly?: boolean;
}

export function trails(issue: Issue, projectId: string, rdos: Rdo[]): Trail[] {
  const out: Trail[] = [{ to: `${caminhoDaObra(projectId, "nao-conformidades")}?nc=${issue.id}`, label: "abrir a peça" }];
  if (issue.mp || issue.pose) {
    out.push({ to: caminhoDaObra(projectId, "tour"), label: "ver no tour 360", fly: true });
  }
  if (issue.floorplanId) {
    out.push({ to: `${caminhoDaObra(projectId, "plantas")}?plan=${issue.floorplanId}&pin=${issue.pinId ?? ""}`, label: "ver na planta" });
  }
  if (issue.rdoId) {
    const rdo = rdos.find((r) => r.id === issue.rdoId);
    out.push({
      to: `${caminhoDaObra(projectId, "diario")}?rdo=${issue.rdoId}`,
      label: rdo ? `RDO nº ${String(rdo.number).padStart(3, "0")}` : "diário de obra",
    });
  }
  return out;
}

/** Data da última verificação registrada em visita. */
export const lastVerification = (issue: Issue) => issue.verifications?.at(-1);

/** Quantos dias a pendência está aberta — entra no relatório de aging. */
export function ageDays(issue: Issue, today = TODAY): number {
  const a = new Date(`${issue.createdAt.slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${today}T00:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / 864e5));
}
