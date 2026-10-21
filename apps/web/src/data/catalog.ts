/**
 * Consultas do catálogo que a API carregou no store.
 *
 * As telas chamam estas funções no render. O App só monta as rotas depois
 * do bootstrap, então a primeira leitura já encontra obra, pavimento e contratada.
 */
import { useApp } from "../store";
import type { Capture, Contractor, Level, Project } from "../types";

export const projectById = (id: string): Project | undefined =>
  useApp.getState().projects.find((p) => p.id === id);

export const levelsOf = (projectId: string): Level[] =>
  useApp.getState().levels.filter((l) => l.projectId === projectId).sort((a, b) => a.order - b.order);

export const contractorById = (id?: string): Contractor | undefined =>
  useApp.getState().contractors.find((c) => c.id === id);

export const capturesOf = (levelId: string): Capture[] =>
  useApp.getState().captures.filter((c) => c.levelId === levelId).sort((a, b) => a.date.localeCompare(b.date));

export function fmtDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
