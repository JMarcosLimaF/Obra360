import { useMemo, useRef, useState } from "react";
import { contractorById, levelsOf } from "../data/catalog";
import { suggestInconsistencies, type NcSuggestion } from "../lib/ai";
import { downscaleDataUrl, fileToDataUrl } from "../lib/image";
import { PRAZO_PADRAO } from "../lib/nc-flow";
import { TODAY } from "../lib/journey";
import { useApp } from "../store";
import type { Issue, NcEvidence, Project } from "../types";
import {
  EmptyState,
  IconAlert,
  IconArrowRight,
  IconCamera,
  IconCheck,
  IconClose,
  IconSpark,
  Micro,
} from "./ui";

const SEV_LABEL: Record<Issue["severity"], string> = {
  baixa: "Baixa", media: "Média", alta: "Alta", critica: "Crítica",
};

const DISCIPLINAS = ["Alvenaria", "Estrutura", "Elétrica", "Hidráulica", "Acabamento", "Segurança"];

const IconUpload = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}
  >
    <path d="M12 15V4" />
    <path d="M7.5 8.5L12 4l4.5 4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

const addDays = (from: string, days: number) =>
  new Date(new Date(`${from}T00:00:00`).getTime() + days * 864e5).toISOString().slice(0, 10);

/**
 * Triagem: a IA propõe, a fiscalização decide.
 *
 * A leitura automática de uma vista é boa para não deixar passar o que o olho
 * cansado deixa, e péssima para virar ato administrativo sozinha. Aqui cada
 * candidata precisa de um aceite humano — e, ao aceitar, quem assina a peça é
 * quem clicou. O descarte também fica registrado, porque a pergunta "por que
 * ninguém apontou isso?" aparece depois, na auditoria.
 */
export default function TriagemPanel({
  project,
  onOpenNc,
  onClose,
}: {
  project: Project;
  onOpenNc: (id: string) => void;
  onClose: () => void;
}) {
  const analyses = useApp((s) => s.analyses).filter((a) => a.projectId === project.id);
  const user = useApp((s) => s.user) ?? "";
  const addIssue = useApp((s) => s.addIssue);
  const levels = useMemo(() => levelsOf(project.id), [project.id]);
  const contractor = contractorById(project.contractorId);
  const fileRef = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState<string | null>(analyses[0]?.imageDataUrl ?? null);
  const [levelId, setLevelId] = useState(levels[0]?.id ?? "");
  const [rodando, setRodando] = useState(false);
  const [simulada, setSimulada] = useState(false);
  const [itens, setItens] = useState<NcSuggestion[] | null>(null);
  const [descartadas, setDescartadas] = useState<string[]>([]);
  const [criadas, setCriadas] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);

  const levelName = levels.find((l) => l.id === levelId)?.name ?? "";

  const analisar = async () => {
    if (!image) return;
    setRodando(true);
    setErro(null);
    try {
      const r = await suggestInconsistencies(image, { project: project.name, level: levelName, projectId: project.id });
      setItens(r.itens);
      setSimulada(r.simulated);
      if (r.itens.length === 0) setErro("A IA não apontou inconsistências nesta vista.");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao analisar a vista.");
    } finally {
      setRodando(false);
    }
  };

  const enviarArquivo = async (file: File) => {
    setErro(null);
    if (!file.type.startsWith("image/")) {
      setErro("Envie uma imagem (JPG ou PNG).");
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setImage(await downscaleDataUrl(dataUrl, 1100, 0.82));
    setItens(null);
  };

  const aceitar = (s: NcSuggestion, idx: number) => {
    if (!image) return;
    const severity = (["baixa", "media", "alta", "critica"] as const).includes(s.severidade)
      ? s.severidade
      : "media";
    const evidence: NcEvidence = {
      id: `ev-img-${Date.now().toString(36)}-${idx}`,
      kind: "abertura",
      imageDataUrl: image,
      author: user,
      role: "fiscalizacao",
      note: "Vista analisada na triagem",
      createdAt: new Date().toISOString(),
    };
    const nc = addIssue({
      projectId: project.id,
      levelId: levelId || undefined,
      origin: "viewer",
      local: s.local ? `${levelName} · ${s.local}` : levelName,
      title: s.titulo,
      description: s.descricao,
      discipline: DISCIPLINAS.includes(s.disciplina) ? s.disciplina : "Alvenaria",
      severity,
      norma: s.norma,
      assignee: contractor?.razaoSocial ?? "Contratada",
      dueDate: addDays(TODAY, PRAZO_PADRAO[severity]),
      evidences: [evidence],
    });
    setCriadas((c) => ({ ...c, [`${idx}`]: nc.id }));
  };

  /* severidade com o tom suave do contrato visual */
  const sevTom = (sv: Issue["severity"]) =>
    sv === "critica" || sv === "alta"
      ? "bg-[#fdeeec] text-danger ring-[#f5d0cb]"
      : sv === "media"
        ? "bg-[#fdf4e2] text-warn ring-[#efdcb0]"
        : "bg-subtle text-ink-2 ring-line";

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-6 sm:px-6 lg:pt-7">
      <div className="reveal mb-6 flex items-start justify-between gap-4" style={{ ["--i" as string]: 0 }}>
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-brand-soft to-white text-action ring-1 ring-inset ring-[#cfe7fb]">
            <IconSpark className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[20px] font-bold leading-snug tracking-[-0.02em] text-ink">
              Triagem de inconsistências
            </h2>
            <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-ink-2">
              A IA lê a vista e propõe candidatas a não conformidade. Nada vira notificação sem o
              seu aceite — a peça nasce em rascunho, com o seu nome como autor.
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar triagem"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-3 transition hover:bg-ink/5 hover:text-ink"
        >
          <IconClose className="h-4 w-4" />
        </button>
      </div>

      {/* fonte da imagem */}
      <section className="card reveal mb-5 overflow-hidden" style={{ ["--i" as string]: 1 }}>
        <div className="card-head flex-wrap">
          <h3 className="card-title mr-auto flex items-center gap-2">
            <IconCamera className="h-4 w-4 text-ink-3" />
            Vista a analisar
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={levelId}
              onChange={(e) => setLevelId(e.target.value)}
              aria-label="Pavimento"
              className="field h-9 w-auto py-0 text-[12.5px]"
            >
              {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <button onClick={() => fileRef.current?.click()} className="btn btn-secondary">
              <IconUpload className="h-4 w-4 text-ink-3" />
              Enviar foto
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void enviarArquivo(f);
                e.target.value = "";
              }}
            />
            <button onClick={analisar} disabled={!image || rodando} className="btn btn-primary">
              <IconSpark className={`h-4 w-4 ${rodando ? "animate-spin" : ""}`} />
              {rodando ? "lendo a vista…" : "Analisar inconsistências"}
            </button>
          </div>
        </div>

        <div className="p-5">
          {image ? (
            <div className="relative overflow-hidden rounded-xl ring-1 ring-line">
              <img src={image} alt="Vista em triagem" className="block w-full" />
              {rodando && (
                <div
                  aria-hidden
                  className="absolute inset-0 animate-shimmer bg-[linear-gradient(100deg,transparent_30%,rgb(0_155_255/0.22)_50%,transparent_70%)] bg-[length:200%_100%]"
                />
              )}
            </div>
          ) : (
            <EmptyState icon={<IconCamera className="h-6 w-6" />} title="Nenhuma vista disponível." className="py-8">
              Analise uma vista no Tour 360 ou envie uma foto do canteiro para começar a triagem.
            </EmptyState>
          )}

          {analyses.length > 1 && (
            <div className="-mx-1 mt-3 flex gap-2.5 overflow-x-auto px-1 pb-1 pt-1">
              {analyses.slice(0, 12).map((a) => (
                <button
                  key={a.id}
                  onClick={() => { setImage(a.imageDataUrl); setItens(null); }}
                  className={`group shrink-0 overflow-hidden rounded-lg transition-[box-shadow,opacity] duration-200 ${
                    image === a.imageDataUrl ? "ring-2 ring-brand ring-offset-2" : "opacity-80 ring-1 ring-line hover:opacity-100 hover:ring-field"
                  }`}
                >
                  <img
                    src={a.imageDataUrl}
                    alt=""
                    className="h-14 w-20 object-cover transition-transform duration-500 ease-out-expo group-hover:scale-110"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {erro && (
        <p className="mb-5 flex animate-pop items-start gap-2.5 rounded-xl bg-[#fdeeec] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-danger ring-1 ring-inset ring-[#f5d0cb]">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </p>
      )}

      {simulada && itens && (
        <p className="mb-5 flex animate-pop items-start gap-2.5 rounded-xl bg-[#fdf4e2] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-warn ring-1 ring-inset ring-[#efdcb0]">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Triagem simulada — configure a chave da API Anthropic para a leitura real da vista.</span>
        </p>
      )}

      {/* candidatas */}
      {itens && itens.length > 0 && (
        <section className="space-y-3">
          <Micro className="block px-1">
            {itens.length} candidata{itens.length === 1 ? "" : "s"} · aceite o que você confirma em campo
          </Micro>
          {itens.map((s, idx) => {
            const criada = criadas[`${idx}`];
            const descartada = descartadas.includes(`${idx}`);
            const sv = (["baixa","media","alta","critica"] as const).includes(s.severidade) ? s.severidade : "media";
            return (
              <article
                key={idx}
                className={`card reveal p-5 transition-[opacity,border-color,box-shadow] duration-300 ${
                  descartada ? "opacity-50" : criada ? "border-[#c4e5d0] shadow-[0_0_0_3px_rgb(47_138_91/0.08)]" : "card-hover"
                }`}
                style={{ ["--i" as string]: Math.min(idx + 1, 12) }}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-[14.5px] font-semibold tracking-[-0.01em] text-ink">{s.titulo}</h3>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${sevTom(sv)}`}>
                    {SEV_LABEL[sv]}
                  </span>
                  <span className="rounded-full bg-subtle px-2.5 py-0.5 text-[11px] font-semibold text-ink-2 ring-1 ring-inset ring-line">
                    confiança {s.confianca}
                  </span>
                  {!s.verificavel && (
                    <span className="rounded-full bg-[#fdf4e2] px-2.5 py-0.5 text-[11px] font-semibold text-warn ring-1 ring-inset ring-[#efdcb0]">
                      conferir em campo
                    </span>
                  )}
                </div>
                <p className="text-[13px] leading-relaxed text-ink-2">{s.descricao}</p>
                <Micro className="mt-2 block">
                  {s.disciplina}
                  {s.local && ` · ${s.local}`}
                  {s.norma && ` · ${s.norma}`}
                </Micro>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-2 pt-4">
                  {criada ? (
                    <>
                      <span className="inline-flex animate-pop items-center gap-1.5 rounded-full bg-[#e8f6ed] px-2.5 py-1 text-[11.5px] font-semibold text-positive ring-1 ring-inset ring-[#c4e5d0]">
                        <IconCheck className="h-3.5 w-3.5" />
                        não conformidade criada
                      </span>
                      <button
                        onClick={() => onOpenNc(criada)}
                        className="group inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-action transition hover:bg-brand-soft hover:text-ink"
                      >
                        abrir a peça
                        <IconArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                      </button>
                    </>
                  ) : descartada ? (
                    <span className="text-[12px] text-ink-3">descartada nesta triagem</span>
                  ) : (
                    <>
                      <button onClick={() => aceitar(s, idx)} className="btn btn-accent btn-sm">
                        <IconCheck className="h-3.5 w-3.5" />
                        Aceitar e abrir NC
                      </button>
                      <button
                        onClick={() => setDescartadas((d) => [...d, `${idx}`])}
                        className="btn btn-ghost btn-sm"
                      >
                        Descartar
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
