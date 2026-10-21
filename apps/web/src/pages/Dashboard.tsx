import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { sCurve } from "../data/mock";
import { contractorById, fmtDate, levelsOf, projectById } from "../data/catalog";
import { levelStatuses } from "../lib/journey";
import { isOverdue, repairDays } from "../lib/nc-flow";
import { thumbUrl } from "../lib/matterport";
import { caminhoDaObra, useObraId } from "../obra";
import { useApp } from "../store";
import {
  CountUp,
  EmptyState,
  IconAlert,
  IconArrowRight,
  IconArrowUpRight,
  IconBook,
  IconBriefcase,
  IconCheck,
  IconClock,
  IconLayers,
  IconMapPin,
  IconReport,
  IconRotate360,
  IconSpark,
  IconTrendUp,
  ProgressRing,
  StatusChip,
} from "../components/ui";

const TODAY = "2026-08-30";

const ddmm = (iso: string) => iso.slice(5, 10).split("-").reverse().join("/");

export default function Dashboard() {
  const projectId = useObraId();
  const project = projectById(projectId);
  const issues = useApp((s) => s.issues).filter((i) => i.projectId === projectId);
  const analyses = useApp((s) => s.analyses).filter((a) => a.projectId === projectId);

  const floorplans = useApp((s) => s.floorplans).filter((f) => f.projectId === projectId);
  const rdos = useApp((s) => s.rdos)
    .filter((r) => r.projectId === projectId)
    .sort((a, b) => b.date.localeCompare(a.date));

  const lvls = levelsOf(projectId);
  // a leitura que atravessa os quatro módulos, pavimento a pavimento
  const status = levelStatuses(lvls, floorplans, issues, rdos);

  if (!project) return null;
  const open = issues.filter((i) => i.status !== "resolvido");
  const overdue = open.filter((i) => i.dueDate < TODAY);
  const lastAnalysis = analyses[0];
  const plansRead = floorplans.filter((f) => f.analysis).length;
  const lastRdo = rdos[0];
  const pins = floorplans.reduce((n, f) => n + f.pins.length, 0);
  const contractor = contractorById(project.contractorId);
  const vencidas = issues.filter((i) => isOverdue(i));
  const tempos = issues.map(repairDays).filter((d): d is number => d !== null);
  const tempoMedio = tempos.length ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : null;
  const cover = project.coverUrl ?? (project.matterportId ? thumbUrl(project.matterportId) : undefined);
  const planTotal = floorplans.length || lvls.length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-5 pb-12 pt-1 lg:px-8">
        {/* destaque da obra */}
        <section
          className="reveal relative overflow-hidden rounded-[26px] bg-[linear-gradient(120deg,#0e3656_0%,#0a2540_60%,#061a2e_100%)] text-white shadow-xl"
          style={{ ["--i" as string]: 0 }}
        >
          {cover && <HeroImage src={cover} />}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.04)_1px,transparent_1px)] bg-[size:26px_26px] [mask-image:linear-gradient(90deg,black_30%,transparent_75%)]" />
          <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 animate-float rounded-full bg-brand/25 blur-3xl" />

          <div className="relative flex flex-col gap-8 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 max-w-2xl">
              <p className="mb-3 inline-flex max-w-full items-center gap-2 truncate rounded-full bg-white/10 px-3 py-1 text-[11.5px] font-semibold text-white/80 ring-1 ring-inset ring-white/15 backdrop-blur">
                <span className="relative grid h-2 w-2 place-items-center">
                  <span className="absolute h-2 w-2 animate-ping rounded-full bg-[#5cc4ff]/70" />
                  <span className="h-2 w-2 rounded-full bg-[#5cc4ff]" />
                </span>
                Obra em execução · {project.client}
              </p>
              <h1 className="font-display text-[28px] font-bold leading-[1.1] tracking-[-0.03em] sm:text-[34px]">{project.name}</h1>
              <p className="mt-2.5 flex items-start gap-2 text-[13.5px] text-white/65">
                <IconMapPin className="mt-0.5 h-4 w-4 shrink-0" />
                {project.address}
              </p>
              <p className="mt-1.5 flex items-center gap-2 text-[12.5px] text-white/50">
                <IconClock className="h-4 w-4 shrink-0" />
                {lastRdo
                  ? `Última visita ${fmtDate(lastRdo.date)} · RDO nº ${String(lastRdo.number).padStart(3, "0")}`
                  : "Nenhuma visita registrada"}
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <Link to={caminhoDaObra(projectId, "tour")} className="btn btn-lg btn-accent">
                  <IconRotate360 className="h-[17px] w-[17px]" />
                  Abrir tour 360
                </Link>
                <Link
                  to={caminhoDaObra(projectId, "relatorios")}
                  className="btn btn-lg bg-white/10 text-white ring-1 ring-inset ring-white/20 backdrop-blur hover:bg-white/20"
                >
                  <IconReport className="h-[17px] w-[17px]" />
                  Gerar relatório
                </Link>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-5 rounded-3xl bg-white/[0.07] p-5 ring-1 ring-inset ring-white/12 backdrop-blur-md">
              <ProgressRing value={project.progressPct} size={112} stroke={9} track="rgb(255 255 255 / 0.12)">
                <div className="text-center">
                  <p className="font-display text-[28px] font-bold leading-none tracking-[-0.03em]">
                    <CountUp value={project.progressPct} />
                    <span className="text-[16px]">%</span>
                  </p>
                  <p className="mt-1 text-[10.5px] font-medium text-white/55">executado</p>
                </div>
              </ProgressRing>
              <div className="space-y-3 pr-1">
                <div>
                  <p className="text-[11.5px] font-medium text-white/50">Avanço físico</p>
                  <p className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#7ee2a8]">
                    <IconTrendUp className="h-3.5 w-3.5" /> +2 pp vs. planejado
                  </p>
                </div>
                <div>
                  <p className="text-[11.5px] font-medium text-white/50">Entrega prevista</p>
                  <p className="text-[13px] font-semibold">{fmtDate(project.plannedEnd)}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* o contrato: quem executa, o que está vencido, quanto demora o reparo */}
        {contractor && (
          <Link
            to={caminhoDaObra(projectId, "contrato")}
            className="card card-hover reveal group mt-5 flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4"
            style={{ ["--i" as string]: 1 }}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-action">
                <IconBriefcase className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[11.5px] font-medium text-ink-3">Contratada</span>
                <span className="block truncate text-[13.5px] font-semibold text-ink">{contractor.razaoSocial}</span>
              </span>
            </span>
            {project.contract && (
              <Fact label="Contrato">
                <span className="font-mono text-[12.5px]">{project.contract.numero}</span>
              </Fact>
            )}
            <Fact label="Prazos vencidos">
              <span className={vencidas.length ? "font-semibold text-danger" : ""}>
                {vencidas.length === 0 ? "nenhum" : `${vencidas.length} não conformidade${vencidas.length === 1 ? "" : "s"}`}
              </span>
            </Fact>
            <Fact label="Tempo médio de reparo">{tempoMedio === null ? "—" : `${tempoMedio} dias`}</Fact>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-action">
              Ver contrato
              <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </span>
          </Link>
        )}

        {/* indicadores */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <Kpi
            i={2}
            icon={<IconTrendUp className="h-[18px] w-[18px]" />}
            label="Avanço físico"
            value={project.progressPct}
            suffix="%"
            sub="+2 pp vs. planejado"
            subTone="positive"
          />
          <Kpi
            i={3}
            icon={<IconAlert className="h-[18px] w-[18px]" />}
            label="Não conformidades"
            value={open.length}
            sub={`${overdue.length} vencida${overdue.length === 1 ? "" : "s"}`}
            subTone={overdue.length ? "danger" : "muted"}
            tone={overdue.length ? "danger" : "default"}
            to={caminhoDaObra(projectId, "nao-conformidades")}
          />
          <Kpi
            i={4}
            icon={<IconBook className="h-[18px] w-[18px]" />}
            label="Visitas registradas"
            value={rdos.length}
            sub={lastRdo ? `última em ${fmtDate(lastRdo.date)}` : "nenhum RDO ainda"}
            to={caminhoDaObra(projectId, "diario")}
          />
          <Kpi
            i={5}
            icon={<IconLayers className="h-[18px] w-[18px]" />}
            label="Plantas lidas"
            value={plansRead}
            suffix={`/${planTotal}`}
            sub={`${pins} ponto${pins === 1 ? "" : "s"} marcado${pins === 1 ? "" : "s"}`}
            to={caminhoDaObra(projectId, "plantas")}
          />
        </div>

        {/* curva S + coluna lateral */}
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <section className="card reveal p-5 sm:p-6 lg:col-span-2" style={{ ["--i" as string]: 6 }}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="card-title">Curva S — avanço físico 2026</h2>
                <p className="mt-0.5 text-[12px] text-ink-3">Planejado × realizado, acumulado por mês</p>
              </div>
              <div className="flex items-center gap-2 text-[11.5px] font-semibold">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-action">
                  <span className="h-2 w-2 rounded-full bg-action" /> Realizado
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f6ed] px-2.5 py-1 text-positive">
                  <span className="h-0.5 w-3 rounded-full border-t-2 border-dashed border-positive" /> Planejado
                </span>
              </div>
            </div>
            <SCurveChart />
          </section>

          <div className="flex flex-col gap-5">
            <section className="card reveal flex-1 p-5" style={{ ["--i" as string]: 7 }}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="card-title">Últimas visitas</h2>
                <Link to={caminhoDaObra(projectId, "diario")} className="btn btn-ghost btn-sm -mr-2 text-action">
                  Diário de obra
                  <IconArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {rdos.length === 0 ? (
                <div className="rounded-xl bg-subtle px-4 py-5 text-center ring-1 ring-inset ring-line-2">
                  <span className="mx-auto mb-2.5 grid h-10 w-10 place-items-center rounded-xl bg-white text-action shadow-xs ring-1 ring-line">
                    <IconBook className="h-[18px] w-[18px]" />
                  </span>
                  <p className="text-[12.5px] leading-relaxed text-ink-2">
                    Nenhuma visita registrada. No <b className="font-semibold text-ink">Diário de obra</b>, abra um RDO e
                    percorra a obra pelo tour para registrar as frentes.
                  </p>
                </div>
              ) : (
                <div className="-mx-2 flex flex-col gap-0.5">
                  {rdos.slice(0, 4).map((r) => {
                    const fotos = r.stops.reduce((n, t) => n + t.photos.length, 0);
                    return (
                      <Link
                        key={r.id}
                        to={`${caminhoDaObra(projectId, "diario")}?rdo=${r.id}`}
                        className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-subtle"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-action">
                          <IconReport className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-ink">
                            RDO nº {String(r.number).padStart(3, "0")} — {fmtDate(r.date)}
                          </p>
                          <p className="text-[11.5px] text-ink-3">
                            {r.stops.length} frente{r.stops.length === 1 ? "" : "s"} · {fotos} foto{fotos === 1 ? "" : "s"}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${
                            r.status === "fechado"
                              ? "bg-[#e8f6ed] text-positive ring-[#c4e5d0]"
                              : "bg-[#fdf4e2] text-warn ring-[#efdcb0]"
                          }`}
                        >
                          {r.status === "fechado" ? "fechado" : "rascunho"}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>

            <section
              className="reveal relative overflow-hidden rounded-2xl bg-[linear-gradient(140deg,#eef7ff_0%,#ffffff_60%)] p-5 shadow-sm ring-1 ring-inset ring-[#d6eafb]"
              style={{ ["--i" as string]: 8 }}
            >
              <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-brand/15 blur-2xl" />
              <div className="relative mb-2.5 flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-[#38b6ff] to-action text-white shadow-[0_6px_14px_-6px_rgb(0_155_255/0.8)]">
                  <IconSpark className="h-4 w-4" />
                </span>
                <h2 className="card-title">Última análise IA</h2>
              </div>
              {lastAnalysis ? (
                <div className="relative">
                  <p className="text-[12.5px] leading-relaxed text-ink-2">
                    “{lastAnalysis.result.slice(0, 140)}{lastAnalysis.result.length > 140 ? "…" : ""}”
                  </p>
                  <p className="mt-2.5 text-[11.5px] font-medium text-ink-3">
                    {new Date(lastAnalysis.createdAt).toLocaleString("pt-BR")}
                    {lastAnalysis.simulated && " · simulada"}
                  </p>
                </div>
              ) : (
                <p className="relative text-[12.5px] leading-relaxed text-ink-2">
                  Nenhuma análise ainda. No Tour 360, use <b className="font-semibold text-ink">Analisar com IA</b> para
                  gerar uma análise da vista atual.
                </p>
              )}
            </section>
          </div>
        </div>

        {/* onde os módulos se encontram: o pavimento */}
        <section className="card reveal mt-5 overflow-hidden" style={{ ["--i" as string]: 9 }}>
          <div className="card-head">
            <div>
              <h2 className="card-title">Situação por pavimento</h2>
              <p className="mt-0.5 text-[12px] text-ink-3">Projeto, registro 360, visita e cobrança lado a lado</p>
            </div>
            <Link to={caminhoDaObra(projectId, "plantas")} className="btn btn-secondary btn-sm">
              <IconLayers className="h-3.5 w-3.5" />
              Plantas
            </Link>
          </div>
          <div className="hidden grid-cols-[1.4fr_1.5fr_1.3fr_1.5fr_auto] gap-x-4 bg-subtle px-5 py-2.5 text-[11.5px] font-semibold text-ink-3 lg:grid">
            <span>Pavimento</span>
            <span>Planta</span>
            <span>Não conformidades</span>
            <span>Última visita</span>
            <span className="w-14" />
          </div>
          {status.map((st, idx) => (
            <div
              key={st.level.id}
              className={`grid items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-subtle/70 lg:grid-cols-[1.4fr_1.5fr_1.3fr_1.5fr_auto] ${
                idx < status.length - 1 ? "border-b border-line-2" : ""
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink/[0.05] text-[12px] font-bold text-ink-2 tabular">
                  {idx + 1}
                </span>
                <span className="text-[13px] font-semibold text-ink">{st.level.name}</span>
              </span>

              <span>
                {!st.plan ? (
                  <Link
                    to={caminhoDaObra(projectId, "plantas")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-field px-2.5 py-1 text-[11.5px] font-semibold text-action transition hover:border-brand hover:bg-brand-soft"
                  >
                    <IconLayers className="h-3.5 w-3.5" />
                    Carregar prancha
                  </Link>
                ) : (
                  <Link
                    to={`${caminhoDaObra(projectId, "plantas")}?plan=${st.plan.id}`}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset transition hover:brightness-95 ${
                      st.planRead ? "bg-[#e8f6ed] text-positive ring-[#c4e5d0]" : "bg-[#fdf4e2] text-warn ring-[#efdcb0]"
                    }`}
                  >
                    {st.planRead ? <IconCheck className="h-3.5 w-3.5" /> : <IconClock className="h-3.5 w-3.5" />}
                    {st.planRead ? "Lida pela IA" : "Não lida"}
                    {st.pins > 0 && ` · ${st.pins} ponto${st.pins === 1 ? "" : "s"}`}
                  </Link>
                )}
              </span>

              <span className="text-[12.5px] text-ink-2">
                {st.open.length === 0 ? (
                  <span className="text-ink-3">Nenhuma aberta</span>
                ) : (
                  <>
                    <b className="font-semibold text-ink">{st.open.length}</b> aberta{st.open.length === 1 ? "" : "s"}
                    {st.overdue.length > 0 && (
                      <span className="font-semibold text-danger"> · {st.overdue.length} vencida{st.overdue.length === 1 ? "" : "s"}</span>
                    )}
                    {st.critical.length > 0 && (
                      <span className="text-danger"> · {st.critical.length} crítica{st.critical.length === 1 ? "" : "s"}</span>
                    )}
                  </>
                )}
              </span>

              <span className="text-[12.5px] text-ink-2">
                {st.lastVisit ? (
                  <Link to={`${caminhoDaObra(projectId, "diario")}?rdo=${st.lastVisit.rdo.id}`} className="hover:text-ink">
                    {fmtDate(st.lastVisit.rdo.date)} · RDO nº {String(st.lastVisit.rdo.number).padStart(3, "0")}
                    {st.photos.length > 0 && ` · ${st.photos.length} foto${st.photos.length === 1 ? "" : "s"}`}
                  </Link>
                ) : (
                  <span className="text-ink-3">Nunca visitado no diário</span>
                )}
              </span>

              <Link
                to={caminhoDaObra(projectId, "tour")}
                className="btn btn-ghost btn-sm justify-self-start text-action lg:justify-self-end"
              >
                <IconRotate360 className="h-[15px] w-[15px]" />
                Tour
              </Link>
            </div>
          ))}
        </section>

        {/* pendências */}
        <section className="card reveal mt-5 overflow-hidden" style={{ ["--i" as string]: 10 }}>
          <div className="card-head">
            <div className="flex items-center gap-2.5">
              <h2 className="card-title">Não conformidades abertas</h2>
              <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-bold text-ink-2 tabular">{open.length}</span>
            </div>
            <Link to={caminhoDaObra(projectId, "nao-conformidades")} className="btn btn-secondary btn-sm">
              Ver todas
              <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {open.length === 0 ? (
            <EmptyState icon={<IconCheck className="h-6 w-6" />} title="Tudo em dia" className="py-8">
              Nenhuma não conformidade aberta nesta obra.
            </EmptyState>
          ) : (
            <>
              <div className="hidden grid-cols-[2.6fr_1.2fr_1fr_1.4fr_1fr_1.2fr] gap-x-4 bg-subtle px-5 py-2.5 text-[11.5px] font-semibold text-ink-3 md:grid">
                <span>Não conformidade</span>
                <span>Local</span>
                <span>Disciplina</span>
                <span>Responsável</span>
                <span>Prazo</span>
                <span>Situação</span>
              </div>
              {open.slice(0, 5).map((i, idx) => {
                const late = i.dueDate < TODAY;
                return (
                  <Link
                    key={i.id}
                    to={`${caminhoDaObra(projectId, "nao-conformidades")}?nc=${i.id}`}
                    className={`relative grid items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-subtle/70 md:grid-cols-[2.6fr_1.2fr_1fr_1.4fr_1fr_1.2fr] ${
                      idx < Math.min(open.length, 5) - 1 ? "border-b border-line-2" : ""
                    }`}
                  >
                    {late && <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-danger" />}
                    <span className="min-w-0">
                      {i.code && <span className="mr-2 font-mono text-[11px] font-medium text-ink-3">{i.code}</span>}
                      <span className="text-[13px] font-semibold text-ink">{i.title}</span>
                    </span>
                    <span className="truncate text-[12.5px] text-ink-2">{i.local}</span>
                    <span className="truncate text-[12.5px] text-ink-2">{i.discipline}</span>
                    <span className="truncate text-[12.5px] text-ink-2">{i.assignee}</span>
                    <span className={`inline-flex items-center gap-1.5 text-[12.5px] tabular ${late ? "font-semibold text-danger" : "text-ink-2"}`}>
                      <IconClock className="h-3.5 w-3.5" />
                      {ddmm(i.dueDate)}
                      {late && " · vencida"}
                    </span>
                    <span>
                      <StatusChip status={i.status} nc={i.ncStatus} />
                    </span>
                  </Link>
                );
              })}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** Foto da obra à direita do destaque, dissolvendo no navy. */
function HeroImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 w-full lg:w-[62%]">
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className="h-full w-full object-cover opacity-55 animate-fade"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,#0a2540_0%,rgb(10_37_64/0.75)_35%,rgb(10_37_64/0.25)_100%)]" />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="min-w-0">
      <span className="block text-[11.5px] font-medium text-ink-3">{label}</span>
      <span className="block text-[13px] text-ink-2">{children}</span>
    </span>
  );
}

function Kpi({
  i,
  icon,
  label,
  value,
  suffix,
  sub,
  subTone = "muted",
  tone = "default",
  to,
}: {
  i: number;
  icon: ReactNode;
  label: string;
  value: number;
  suffix?: string;
  sub?: string;
  subTone?: "muted" | "positive" | "danger";
  tone?: "default" | "danger";
  to?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium text-ink-3">{label}</p>
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform duration-500 ease-out-expo group-hover:scale-110 group-hover:rotate-[-6deg] ${
            tone === "danger" ? "bg-[#fdeeec] text-danger" : "bg-brand-soft text-action"
          }`}
        >
          {icon}
        </span>
      </div>
      <p className={`mt-1.5 font-display text-[30px] font-bold leading-none tracking-[-0.03em] ${tone === "danger" ? "text-danger" : "text-ink"}`}>
        <CountUp value={value} />
        {suffix && <span className="ml-0.5 text-[18px] text-ink-3">{suffix}</span>}
      </p>
      {sub && (
        <p
          className={`mt-2 text-[11.5px] font-medium ${
            subTone === "positive" ? "text-positive" : subTone === "danger" ? "text-danger" : "text-ink-3"
          }`}
        >
          {sub}
        </p>
      )}
    </>
  );
  const cls = "card reveal group relative overflow-hidden p-4 sm:p-5";
  return to ? (
    <Link to={to} className={`${cls} card-hover`} style={{ ["--i" as string]: i }}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={{ ["--i" as string]: i }}>
      {body}
    </div>
  );
}

function SCurveChart() {
  const [hover, setHover] = useState<number | null>(null);
  const w = 860, h = 260, left = 40, right = 840, top = 18, bottom = 222;
  const x = (i: number) => left + (i * (right - left)) / (sCurve.length - 1);
  const y = (v: number) => bottom - (v * (bottom - top)) / 100;
  const planned = sCurve.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.planned)}`).join(" ");
  const actualPts = sCurve.filter((p) => p.actual !== null);
  const actual = actualPts.map((p, i) => `${i ? "L" : "M"}${x(sCurve.indexOf(p))},${y(p.actual!)}`).join(" ");
  const lastActual = actualPts.at(-1)!;
  const li = sCurve.indexOf(lastActual);
  const lx = x(li);
  const area = `${actual} L${lx},${bottom} L${x(0)},${bottom} Z`;
  const step = (right - left) / (sCurve.length - 1);
  const hp = hover === null ? null : sCurve[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full overflow-visible"
        role="img"
        aria-label="Curva S planejado × realizado"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="scurve-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#009bff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#009bff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="scurve-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38b6ff" />
            <stop offset="100%" stopColor="#0a72d1" />
          </linearGradient>
          <clipPath id="scurve-reveal">
            <rect x="0" y="0" width="0" height={h}>
              <animate attributeName="width" from="0" to={w} dur="1.4s" begin="0.25s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.16 1 0.3 1" />
            </rect>
          </clipPath>
        </defs>

        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={left} y1={y(v)} x2={right} y2={y(v)} stroke={v === 0 ? "#dfe6ee" : "#eef2f6"} strokeWidth="1" strokeDasharray={v === 0 ? undefined : "3 4"} />
            <text x={left - 10} y={y(v) + 3.5} textAnchor="end" fontSize="10.5" fontWeight="500" fill="#8597a9" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
              {v}
            </text>
          </g>
        ))}

        {/* faixa do futuro */}
        <rect x={lx} y={top} width={right - lx} height={bottom - top} fill="#f7f9fc" />
        <line x1={lx} y1={top} x2={lx} y2={bottom} stroke="#c9d6e2" strokeWidth="1" strokeDasharray="3 4" />
        <text x={lx + 8} y={top + 12} fontSize="10.5" fontWeight="600" fill="#8597a9" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
          hoje
        </text>

        <g clipPath="url(#scurve-reveal)">
          <path d={area} fill="url(#scurve-area)" />
          <path d={planned} fill="none" stroke="#2f8a5b" strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round" opacity="0.85" />
          <path d={actual} fill="none" stroke="url(#scurve-line)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        <g className="animate-fade" style={{ animationDelay: "1.2s" }}>
          <circle cx={lx} cy={y(lastActual.actual!)} r="11" fill="#009bff" opacity="0.15" />
          <circle cx={lx} cy={y(lastActual.actual!)} r="5" fill="#0a72d1" stroke="#FFFFFF" strokeWidth="2.5" />
        </g>

        {hp && hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} y1={top} x2={x(hover)} y2={bottom} stroke="#0a72d1" strokeOpacity="0.25" strokeWidth="1.5" />
            <circle cx={x(hover)} cy={y(hp.planned)} r="4" fill="#fff" stroke="#2f8a5b" strokeWidth="2" />
            {hp.actual !== null && <circle cx={x(hover)} cy={y(hp.actual)} r="4.5" fill="#fff" stroke="#0a72d1" strokeWidth="2.5" />}
          </g>
        )}

        {sCurve.map((p, i) => (
          <text
            key={p.month}
            x={x(i)}
            y={h - 12}
            textAnchor="middle"
            fontSize="10.5"
            fontWeight={hover === i ? 700 : 500}
            fill={hover === i ? "#0e3656" : "#8597a9"}
            style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
          >
            {p.month}
          </text>
        ))}

        {sCurve.map((p, i) => (
          <rect
            key={`hit-${p.month}`}
            x={x(i) - step / 2}
            y={top}
            width={step}
            height={bottom - top + 30}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {hp && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 w-36"
          style={{
            left: `${(x(hover) / w) * 100}%`,
            top: `${(Math.min(y(hp.planned), hp.actual !== null ? y(hp.actual) : 999) / h) * 100}%`,
            transform: "translate(-50%, calc(-100% - 14px))",
          }}
        >
          <div key={hover} className="animate-pop rounded-xl bg-navy-900/95 px-3 py-2.5 text-white shadow-xl ring-1 ring-white/10 backdrop-blur">
          <p className="mb-1.5 text-[11.5px] font-bold">{hp.month} · 2026</p>
          <p className="flex items-center justify-between text-[11.5px] text-white/70">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#5cc4ff]" />Realizado</span>
            <b className="font-semibold text-white tabular">{hp.actual === null ? "—" : `${hp.actual}%`}</b>
          </p>
          <p className="flex items-center justify-between text-[11.5px] text-white/70">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#7ee2a8]" />Planejado</span>
            <b className="font-semibold text-white tabular">{hp.planned}%</b>
          </p>
          </div>
        </div>
      )}
    </div>
  );
}
