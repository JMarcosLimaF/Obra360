import { useMemo, useState } from "react";
import { useObraId } from "../obra";
import { fmtDate, levelsOf, projectById } from "../data/catalog";
import { NC_ACTION_LABEL, NC_STATUS_LABEL } from "../types";
import { useApp } from "../store";
import { ageDays, levelStatuses, TODAY } from "../lib/journey";
import { ultimaVerificacao } from "../lib/nc-flow";
import { IconCrosshair, IconFileText, Micro, Wordmark } from "../components/ui";

/** Impressora, no mesmo traço 24 dos ícones de `ui.tsx`. */
const IconPrinter = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d="M7 9V3.5h10V9" />
    <rect x="3.5" y="9" width="17" height="8" rx="2.5" />
    <path d="M7 14h10v6.5H7z" />
    <path d="M17 12h.01" />
  </svg>
);
import RichText, { plainPreview } from "../components/RichText";

const PERIODS = [
  { id: "tudo", label: "Todo o período", days: 0 },
  { id: "30", label: "Últimos 30 dias", days: 30 },
  { id: "90", label: "Últimos 90 dias", days: 90 },
] as const;

const daysAgo = (n: number) =>
  new Date(new Date(`${TODAY}T00:00:00`).getTime() - n * 864e5).toISOString().slice(0, 10);

/**
 * Relatório de acompanhamento — o documento que junta os quatro módulos.
 *
 * O que a obra deveria ser (planta), o que ela é (tour 360), o que aconteceu
 * (diário de obra) e o que falta (pendências), na mesma folha e na mesma ordem
 * em que a fiscalização lê. Imprimível: Ctrl+P → PDF.
 */
export default function Report() {
  const projectId = useObraId();
  const project = projectById(projectId);
  const issues = useApp((s) => s.issues).filter((i) => i.projectId === projectId);
  const analyses = useApp((s) => s.analyses).filter((a) => a.projectId === projectId);
  const floorplans = useApp((s) => s.floorplans).filter((f) => f.projectId === projectId);
  const allRdos = useApp((s) => s.rdos).filter((r) => r.projectId === projectId);
  const [periodId, setPeriodId] = useState<(typeof PERIODS)[number]["id"]>("tudo");

  const period = PERIODS.find((p) => p.id === periodId)!;
  const from = period.days ? daysAgo(period.days) : "0000-01-01";

  const rdos = useMemo(
    () => allRdos.filter((r) => r.date >= from).sort((a, b) => a.date.localeCompare(b.date)),
    [allRdos, from],
  );
  const lvls = useMemo(() => levelsOf(projectId), [projectId]);
  const status = levelStatuses(lvls, floorplans, issues, rdos);

  if (!project) return null;

  const open = issues.filter((i) => i.status !== "resolvido");
  const overdue = open.filter((i) => i.dueDate < TODAY);
  // encerradas pelo trâmite: o ato de aceite é a fonte, não uma trilha paralela
  const solvedInPeriod = issues.filter(
    (i) =>
      i.ncStatus === "sanada" &&
      (i.events ?? []).some((e) => e.action === "aprovar" && e.at.slice(0, 10) >= from),
  );
  const photos = rdos.flatMap((r) =>
    r.stops.flatMap((t) => t.photos.map((f) => ({ photo: f, stop: t, rdo: r }))),
  );
  const plansRead = floorplans.filter((f) => f.analysis);
  const periodDates = rdos.map((r) => r.date);
  const pins = floorplans.reduce((n, f) => n + f.pins.length, 0);

  return (
    <div className="h-full overflow-y-auto">
      {/* controles: barra translúcida que acompanha a rolagem; some na impressão */}
      <div className="pointer-events-none sticky top-0 z-20 px-4 pt-3 sm:px-6 print:hidden">
        <div className="pointer-events-auto mx-auto flex max-w-3xl animate-pop flex-wrap items-center gap-3 rounded-2xl bg-white/75 py-2.5 pl-3 pr-2.5 shadow-md ring-1 ring-line/70 backdrop-blur-xl">
          <div className="mr-auto flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-action ring-1 ring-inset ring-[#cfe7fb]">
              <IconFileText className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-bold leading-tight tracking-[-0.01em] text-ink">Relatório de acompanhamento</p>
              <Micro className="block truncate">{project.name}</Micro>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value as typeof periodId)}
              aria-label="Período do relatório"
              className="field h-9 w-auto cursor-pointer py-0 pr-8"
            >
              {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <button onClick={() => window.print()} className="btn btn-primary">
              <IconPrinter className="h-4 w-4" />
              Gerar PDF (imprimir)
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 pb-14 pt-5 sm:px-6 print:max-w-none print:p-0">
        <div className="animate-rise rounded-3xl bg-white p-6 text-ink shadow-lg ring-1 ring-line/70 sm:p-10 print:animate-none print:rounded-none print:p-0 print:shadow-none print:ring-0">
          {/* capa */}
          <header className="mb-9 border-b border-line pb-7">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <Wordmark className="text-[17px]" />
              <span className="rounded-full bg-brand-soft px-3 py-1 text-[11.5px] font-semibold text-action ring-1 ring-inset ring-[#cfe7fb] print:bg-transparent print:px-0 print:ring-0">
                Obra360 · Relatório de acompanhamento
              </span>
            </div>
            <h1 className="font-display text-[26px] font-bold leading-tight tracking-[-0.025em]">{project.name}</h1>
            <p className="mt-1 text-[13.5px] text-ink-2">{project.client} · {project.address}</p>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
              <Field label="Período">
                {periodDates.length
                  ? `${fmtDate(periodDates[0])} — ${fmtDate(periodDates.at(-1)!)}`
                  : period.label}
              </Field>
              <Field label="Emitido em">{fmtDate(TODAY)}</Field>
              <Field label="Avanço físico">{project.progressPct}%</Field>
              <Field label="Visitas">{rdos.length}</Field>
            </div>
          </header>

          {/* 1. resumo */}
          <Sec n="1" title="Resumo do período">
            <p className="text-sm leading-relaxed text-ink-2">
              Registro visual no tour 360° vinculado à obra (modelo Matterport{" "}
              {project.matterportId ?? "—"}). No período foram registradas{" "}
              <b className="font-semibold text-ink">{rdos.length} visita{rdos.length === 1 ? "" : "s"}</b> no diário de obra, com{" "}
              {photos.length} foto{photos.length === 1 ? "" : "s"} em {rdos.reduce((n, r) => n + r.stops.length, 0)} frentes de
              serviço. Do projeto, {plansRead.length} de {floorplans.length || lvls.length} pranchas
              foram lidas e {pins} ponto{pins === 1 ? "" : "s"} marcado{pins === 1 ? "" : "s"} sobre
              o desenho. A obra tem <b className="font-semibold text-ink">{open.length} não conformidades
              abertas</b>{overdue.length > 0 && <>, das quais <b className="font-semibold text-danger">{overdue.length} vencidas</b></>}
              {solvedInPeriod.length > 0 && <>, e {solvedInPeriod.length} {solvedInPeriod.length === 1 ? "foi verificada e encerrada" : "foram verificadas e encerradas"} em campo</>}.
              O avanço físico acumulado é de {project.progressPct}% (planejado: 60%).
            </p>
          </Sec>

          {/* 2. situação por pavimento */}
          <Sec n="2" title="Situação por pavimento">
            <div className="-mx-1 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
            <table className="w-full min-w-[520px] border-collapse text-xs print:min-w-0">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Pavimento", "Projeto (planta)", "Não conformidades", "Última visita"].map((h) => (
                    <Th key={h}>{h}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {status.map((st) => (
                  <tr key={st.level.id} className="border-b border-line-2 align-top">
                    <td className="py-2.5 pr-3 font-medium">{st.level.name}</td>
                    <td className="py-2.5 pr-3 text-ink-2">
                      {!st.plan
                        ? "prancha não carregada"
                        : `${st.plan.name} · ${st.planRead ? "lida" : "não lida"}${st.pins ? ` · ${st.pins} ponto${st.pins === 1 ? "" : "s"}` : ""}`}
                    </td>
                    <td className="py-2.5 pr-3 text-ink-2">
                      {st.open.length === 0 ? "—" : `${st.open.length} aberta${st.open.length === 1 ? "" : "s"}`}
                      {st.overdue.length > 0 && (
                        <span className="font-semibold text-danger"> · {st.overdue.length} vencida{st.overdue.length === 1 ? "" : "s"}</span>
                      )}
                    </td>
                    <td className="py-2.5 text-ink-2">
                      {st.lastVisit
                        ? `${fmtDate(st.lastVisit.rdo.date)} · RDO nº ${String(st.lastVisit.rdo.number).padStart(3, "0")}`
                        : "sem registro no diário"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Sec>

          {/* 3. projeto */}
          <Sec n="3" title={`Projeto — leitura das plantas (${plansRead.length})`}>
            {plansRead.length === 0 ? (
              <Empty>
                Nenhuma prancha lida no período. Em <b className="font-semibold text-ink">Plantas</b>,
                use "Analisar planta" para registrar a leitura do projeto no relatório.
              </Empty>
            ) : (
              <div className="space-y-6">
                {plansRead.map((f) => (
                  <figure key={f.id} className="break-inside-avoid">
                    <img src={f.imageSrc} alt="" className="w-full rounded-xl border border-line bg-white" />
                    <figcaption className="mt-2 text-[11.5px] font-medium leading-relaxed text-ink-3">
                      {f.name}
                      {f.levelId && ` · ${lvls.find((l) => l.id === f.levelId)?.name ?? ""}`}
                      {f.pins.length > 0 && ` · ${f.pins.length} ponto${f.pins.length === 1 ? "" : "s"} marcado${f.pins.length === 1 ? "" : "s"}`}
                      {f.analysisSimulated && " · leitura simulada (demonstração)"}
                    </figcaption>
                    {f.pins.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {f.pins.map((pin, i) => (
                          <li key={pin.id} className="text-[11px] text-ink-2">
                            <b className="font-semibold text-ink">{i + 1}. {pin.label}</b>
                            {pin.note && ` — ${pin.note}`}
                          </li>
                        ))}
                      </ul>
                    )}
                    <RichText text={f.analysis!} className="mt-2" />
                  </figure>
                ))}
              </div>
            )}
          </Sec>

          {/* 4. registro 360 */}
          <Sec n="4" title={`Registro 360° — análises da vista (${analyses.length})`}>
            {analyses.length === 0 ? (
              <Empty>
                Nenhuma análise gerada. Use "Analisar com IA" no Tour 360 para anexar a leitura da
                vista ao relatório.
              </Empty>
            ) : (
              <div className="space-y-5">
                {analyses.map((a, idx) => (
                  <figure key={a.id} className="break-inside-avoid">
                    <img src={a.imageDataUrl} alt="" className="w-full rounded-xl border border-line" />
                    <figcaption className="mt-2 text-[11.5px] font-medium leading-relaxed text-ink-3">
                      Vista {idx + 1} · {new Date(a.createdAt).toLocaleString("pt-BR")}
                      {a.simulated && " · análise simulada (demonstração)"}
                    </figcaption>
                    <RichText text={a.result} className="mt-2" />
                  </figure>
                ))}
              </div>
            )}
          </Sec>

          {/* 5. diários */}
          <Sec n="5" title={`Diários de obra do período (${rdos.length})`}>
            {rdos.length === 0 ? (
              <Empty>
                Nenhum RDO no período. O diário é o que dá data e responsável ao registro visual.
              </Empty>
            ) : (
              <div className="space-y-4">
                {rdos.map((r) => (
                  <div key={r.id} className="break-inside-avoid border-b border-line-2 pb-4 last:border-0">
                    <p className="text-[13.5px] font-semibold">
                      RDO nº {String(r.number).padStart(3, "0")} — {fmtDate(r.date)}
                      <span className="ml-2 font-normal text-ink-3">
                        {r.status === "fechado" ? "fechado" : "rascunho"} · {r.responsible}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11.5px] font-medium text-ink-3">
                      {r.stops.length} frente{r.stops.length === 1 ? "" : "s"} ·{" "}
                      {r.stops.reduce((n, t) => n + t.photos.length, 0)} foto
                      {r.stops.reduce((n, t) => n + t.photos.length, 0) === 1 ? "" : "s"}
                      {r.stops.length > 0 && ` · ${r.stops.map((t) => t.label).join(", ")}`}
                    </p>
                    {r.servicesExecuted.trim() && (
                      <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
                        <b className="font-semibold text-ink">Serviços executados. </b>
                        {plainPreview(r.servicesExecuted, 420)}
                      </p>
                    )}
                    {r.nonConformities.trim() && (
                      <p className="mt-1 text-xs leading-relaxed text-danger">
                        <b className="font-semibold">Não conformidades. </b>
                        {plainPreview(r.nonConformities, 420)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Sec>

          {/* 6. pendências */}
          <Sec n="6" title={`Não conformidades abertas (${open.length})`}>
            <div className="-mx-1 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
            <table className="w-full min-w-[620px] border-collapse text-xs print:min-w-0">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Não conformidade", "Local", "Responsável", "Aberta há", "Prazo", "Situação"].map((h) => (
                    <Th key={h}>{h}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {open.map((i) => {
                  const check = ultimaVerificacao(i);
                  return (
                    <tr key={i.id} className="border-b border-line-2 align-top">
                      <td className="py-2.5 pr-3">
                        <p className="flex items-center gap-1.5 font-medium">
                          {(i.mp || i.pose) && <IconCrosshair className="h-3 w-3 shrink-0 text-action" />}
                          {i.title}
                        </p>
                        <p className="text-[10px] text-ink-3">{i.description}</p>
                        {check && (
                          <p className="text-[10px] text-ink-3">
                            {NC_ACTION_LABEL[check.action].toLowerCase()}
                            {check.rdoNumber && ` no RDO nº ${String(check.rdoNumber).padStart(3, "0")}`} em{" "}
                            {fmtDate(check.at.slice(0, 10))}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-ink-2">{i.local}</td>
                      <td className="py-2.5 pr-3 text-ink-2">{i.assignee}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-ink-2">{ageDays(i)} d</td>
                      <td className={`py-2 pr-2 ${i.dueDate < TODAY ? "font-bold text-danger" : "text-ink-2"}`}>
                        {i.dueDate.split("-").reverse().join("/")}
                      </td>
                      <td className="py-2.5 text-ink-2">{NC_STATUS_LABEL[i.ncStatus ?? "rascunho"]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </Sec>

          {solvedInPeriod.length > 0 && (
            <Sec n="7" title={`Não conformidades encerradas no período (${solvedInPeriod.length})`}>
              <div className="-mx-1 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
              <table className="w-full min-w-[460px] border-collapse text-xs print:min-w-0">
                <thead>
                  <tr className="border-b border-line text-left">
                    {["Não conformidade", "Local", "Aceita em", "RDO"].map((h) => <Th key={h}>{h}</Th>)}
                  </tr>
                </thead>
                <tbody>
                  {solvedInPeriod.map((i) => {
                    const v = (i.events ?? []).filter((e) => e.action === "aprovar").at(-1)!;
                    return (
                      <tr key={i.id} className="border-b border-line-2">
                        <td className="py-2.5 pr-3 font-medium">
                          <span className="font-mono text-[10px] text-ink-3">{i.code} </span>
                          {i.title}
                        </td>
                        <td className="py-2.5 pr-3 text-ink-2">{i.local}</td>
                        <td className="py-2.5 pr-3 text-ink-2">{fmtDate(v.at.slice(0, 10))}</td>
                        <td className="py-2.5 text-ink-2">
                          {v.rdoNumber ? `nº ${String(v.rdoNumber).padStart(3, "0")}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </Sec>
          )}

          {photos.length > 0 && (
            <Sec n={solvedInPeriod.length > 0 ? "8" : "7"} title={`Anexo fotográfico das visitas (${photos.length})`}>
              <div className="grid grid-cols-2 gap-4">
                {photos.map(({ photo, stop, rdo }, i) => (
                  <figure key={photo.id} className="break-inside-avoid">
                    <img src={photo.imageDataUrl} alt="" className="w-full rounded-xl border border-line" />
                    <figcaption className="mt-1.5 text-[11px] font-medium leading-relaxed text-ink-3">
                      Foto {String(i + 1).padStart(2, "0")} — {stop.label} · RDO nº{" "}
                      {String(rdo.number).padStart(3, "0")}
                      {photo.caption && ` — ${photo.caption}`}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </Sec>
          )}

          <footer className="mt-10 border-t border-line pt-4 text-[11px] leading-relaxed text-ink-3">
            Documento gerado pela plataforma Obra360. Não conformidades com o marcador de mira
            estão ancoradas por coordenada 3D ou vista salva no tour 360° da obra.
          </footer>
        </div>
      </div>
    </div>
  );
}

function Sec({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 flex items-center gap-2.5 font-display text-[16px] font-bold tracking-[-0.015em]">
        <span className="grid h-7 min-w-7 place-items-center rounded-lg bg-brand-soft px-1.5 text-[12px] font-bold tabular text-action ring-1 ring-inset ring-[#cfe7fb] print:h-auto print:min-w-0 print:bg-transparent print:px-0 print:ring-0">
          {n}.
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="whitespace-nowrap py-2 pr-3 text-[11px] font-semibold text-ink-3">
    {children}
  </th>
);

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-xl border border-dashed border-line bg-subtle px-4 py-3.5 text-[13px] leading-relaxed text-ink-3 print:bg-transparent">
    {children}
  </p>
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-subtle px-3.5 py-3 ring-1 ring-inset ring-line-2 print:bg-transparent print:px-0 print:py-0 print:ring-0">
      <Micro className="block">{label}</Micro>
      <p className="mt-0.5 text-[13px] font-semibold tabular text-ink">{children}</p>
    </div>
  );
}
