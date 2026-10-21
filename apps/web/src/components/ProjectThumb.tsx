import { useState } from "react";
import { thumbUrl } from "../lib/matterport";
import type { Project } from "../types";

/** Iniciais das duas primeiras palavras que não são preposição. */
export function projectInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 || /\d/.test(w));
  return (words[0]?.[0] ?? "O").toLocaleUpperCase("pt-BR") + (words[1]?.[0] ?? "").toLocaleUpperCase("pt-BR");
}

/**
 * Imagem da obra: a capa enviada; sem capa, a miniatura do modelo Matterport;
 * sem nenhuma (ou se falharem), um degradê com as iniciais.
 */
export default function ProjectThumb({
  project,
  className = "h-9 w-9 rounded-xl",
  textClass = "text-[12px]",
}: {
  project: Project;
  className?: string;
  textClass?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const src = [project.coverUrl, project.matterportId && thumbUrl(project.matterportId)]
    .find((s): s is string => !!s && !failed.includes(s));
  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden bg-gradient-to-br from-[#1b5c8f] to-[#0a2540] ${className}`}>
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed((f) => [...f, src])}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span className={`font-bold tracking-[-0.02em] text-white/90 ${textClass}`}>{projectInitials(project.name)}</span>
      )}
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/15" />
    </span>
  );
}
