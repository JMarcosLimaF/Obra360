import { createContext, createElement, useContext, type ReactNode } from "react";
import { useApp } from "./store";
import type { Project } from "./types";

const ObraIdContext = createContext("");

/** A tela da obra lê o id real por aqui. O endereço mostra o nome, não o código. */
export function ProvedorObra({ id, children }: { id: string; children: ReactNode }) {
  return createElement(ObraIdContext.Provider, { value: id }, children);
}

export function useObraId(): string {
  return useContext(ObraIdContext);
}

/** O trecho do endereço é o nome da obra, do jeito que a pessoa lê. */
export function caminhoDaObra(projectId: string, pagina = ""): string {
  const project = useApp.getState().projects.find((p) => p.id === projectId);
  const base = `/obras/${project?.name ?? projectId}`;
  return pagina ? `${base}/${pagina}` : base;
}

export function obraPeloTrecho(trecho: string): Project | undefined {
  const projects = useApp.getState().projects;
  let nome = trecho;
  try {
    nome = decodeURIComponent(trecho);
  } catch {
    nome = trecho;
  }
  return projects.find((p) => p.name === nome) ?? projects.find((p) => p.id === trecho);
}
