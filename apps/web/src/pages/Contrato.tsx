import { useMemo } from "react";
import { Link } from "react-router-dom";
import { contractorById, fmtDate, levelsOf, projectById } from "../data/catalog";
import { caminhoDaObra, useObraId } from "../obra";
import { useApp } from "../store";
import { ABERTAS, daysLeft, isOverdue, repairDays } from "../lib/nc-flow";
import { TODAY } from "../lib/journey";
import type { Issue } from "../types";
import { NC_STATUS_LABEL } from "../types";
import {
  CountUp,
  EmptyState,
  IconAlert,
  IconArrowRight,
  IconBriefcase,
  IconCheck,
  IconClock,
  IconFileText,
  IconShield,
  IconTrendUp,
  PageHeader,
} from "../components/ui";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Duas NCs da mesma disciplina no mesmo pavimento em menos de 60 dias. */
function reincidencias(issues: Issue[]): { chave: string; itens: Issue[] }[] {
  const grupos = new Map<string, Issue[]>();
  for (const i of issues) {
    const chave = `${i.levelId ?? "sem-pavimento"}|${i.discipline}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), i]);
  }
  const out: { chave: string; itens: Issue[] }[] = [];
  for (const [chave, itens] of grupos) {
    if (itens.length < 2) continue;
    const ord = [...itens].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const perto = ord.some((x, k) => {
      if (k === 0) return false;
      const dt =
        new Date(x.createdAt.slice(0, 10)).getTime() -
        new Date(ord[k - 1].createdAt.slice(0, 10)).getTime();
      return dt <= 60 * 864e5;
    });
    if (perto) out.push({ chave, itens: ord });
  }
  return out;
}

/**
 * O contrato visto de cima — a tela de quem cobra desempenho, não de quem
 * aponta parede torta.
 *
 * Aqui a construtora deixa de ser um nome no campo "responsável" e passa a ter
 * histórico: quanto tempo leva para reparar, quantas vezes o reparo volta, onde
 * reincide. É esse histórico que instrui a análise de risco da próxima
 * licitação — com fato, não com fama.
 */
export default function Contrato() {
  const projectId = useObraId();
  const project = projectById(projectId);
  const allIssues = useApp((s) => s.issues);
  const issues = useMemo(
    () => allIssues.filter((i) => i.projectId === projectId),
    [allIssues, projectId],
  );
  const levels = useMemo(() => levelsOf(projectId), [projectId]);

  if (!project) return null;
  const contractor = contractorById(project.contractorId);
  const c = project.contract;

  const abertas = issues.filter((i) => ABERTAS.includes(i.ncStatus ?? "rascunho"));
  const vencidas = issues.filter((i) => isOverdue(i));
  const sanadas = issues.filter((i) => i.ncStatus === "sanada");
  const notificadas = issues.filter((i) => (i.events ?? []).some((e) => e.action === "notificar"));
  const reprovadas = issues.filter((i) => (i.reopenCount ?? 0) > 0);

  const tempos = sanadas.map(repairDays).filter((d): d is number => d !== null);
  const tempoMedio = tempos.length
    ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length)
    : null;
  const taxaReprovacao = notificadas.length
    ? Math.round((reprovadas.length / notificadas.length) * 100)
    : null;

  const reinc = reincidencias(issues);
  const nomeNivel = (id?: string) => levels.find((l) => l.id === id)?.name ?? "sem pavimento";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-5 pb-12 pt-2 lg:px-8">
        <PageHeader
          className="reveal py-4"
          eyebrow={c ? <span className="font-mono">{c.numero}</span> : "Contrato"}
          title="Contrato e desempenho da contratada"
          subtitle={`${project.name} · ${c?.orgaoContratante ?? project.client}`}
          actions={
            <Link to={caminhoDaObra(projectId, "nao-conformidades")} className="btn btn-secondary">
              <IconAlert className="h-4 w-4" />
              Não conformidades
            </Link>
          }
        />

        {/* identificação */}
        <div className="mt-2 grid gap-5 lg:grid-cols-2">
          <section className="card reveal p-5 sm:p-6" style={{ ["--i" as string]: 1 }}>
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-action">
                <IconFileText className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h2 className="card-title">Contrato</h2>
                {c && <p className="text-[12px] text-ink-3">Vigência {fmtDate(c.vigenciaInicio)} — {fmtDate(c.vigenciaFim)}</p>}
              </div>
            </div>
            {c ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Campo label="Número" mono>{c.numero}</Campo>
                <Campo label="Processo" mono>{c.processo}</Campo>
                <Campo label="Vigência">
                  {fmtDate(c.vigenciaInicio)} — {fmtDate(c.vigenciaFim)}
                </Campo>
                <Campo label="Valor">
                  <span className="font-semibold">{brl(c.valor)}</span>
                </Campo>
                <Campo label="Fiscal designado">{c.fiscalDesignado}</Campo>
                <Campo label="Gestor do contrato">{c.gestorDesignado}</Campo>
                <Campo label="Designação">{c.portariaDesignacao}</Campo>
                <Campo label="Prazos de reparo">
                  <span className="flex flex-wrap gap-1.5 pt-0.5">
                    <Prazo tone="danger">crítica {c.prazos.critica}d</Prazo>
                    <Prazo tone="warn">alta {c.prazos.alta}d</Prazo>
                    <Prazo tone="info">média {c.prazos.media}d</Prazo>
                    <Prazo tone="muted">baixa {c.prazos.baixa}d</Prazo>
                  </span>
                </Campo>
              </dl>
            ) : (
              <p className="text-[12.5px] text-ink-3">Contrato não cadastrado nesta obra.</p>
            )}
          </section>

          <section className="card reveal p-5 sm:p-6" style={{ ["--i" as string]: 2 }}>
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-action">
                <IconBriefcase className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h2 className="card-title">Contratada</h2>
                {contractor && <p className="truncate text-[12px] text-ink-3">{contractor.razaoSocial}</p>}
              </div>
            </div>
            {contractor ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Campo label="Razão social">{contractor.razaoSocial}</Campo>
                <Campo label="CNPJ" mono>{contractor.cnpj}</Campo>
                <Campo label="Responsável técnico">{contractor.responsavelTecnico}</Campo>
                <Campo label="CREA" mono>{contractor.crea}</Campo>
                <Campo label="Preposto na obra">{contractor.preposto}</Campo>
                <Campo label="Contato">
                  <a href={`mailto:${contractor.email}`} className="text-action hover:underline">{contractor.email}</a>
                </Campo>
              </dl>
            ) : (
              <p className="text-[12.5px] text-ink-3">Construtora não vinculada a esta obra.</p>
            )}
          </section>
        </div>

        {/* desempenho */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <Kpi i={3} icon={<IconAlert className="h-[18px] w-[18px]" />} label="Não conformidades" value={abertas.length} sub={`${issues.length} no total`} />
          <Kpi
            i={4}
            icon={<IconClock className="h-[18px] w-[18px]" />}
            label="Vencidas"
            value={vencidas.length}
            sub={vencidas.length ? "cabe reiteração" : "nenhuma no prazo estourado"}
            tone={vencidas.length ? "danger" : "normal"}
          />
          <Kpi
            i={5}
            icon={<IconTrendUp className="h-[18px] w-[18px]" />}
            label="Tempo médio de reparo"
            value={tempoMedio}
            suffix="d"
            sub={`${sanadas.length} sanada${sanadas.length === 1 ? "" : "s"}`}
          />
          <Kpi
            i={6}
            icon={<IconShield className="h-[18px] w-[18px]" />}
            label="Taxa de reprovação"
            value={taxaReprovacao}
            suffix="%"
            sub={`${reprovadas.length} de ${notificadas.length} notificadas`}
            tone={taxaReprovacao !== null && taxaReprovacao >= 30 ? "danger" : "normal"}
          />
        </div>

        {/* vencidas */}
        <section className="card reveal mt-5 overflow-hidden" style={{ ["--i" as string]: 7 }}>
          <div className="card-head">
            <div className="flex items-center gap-3">
              <span className={`grid h-9 w-9 place-items-center rounded-xl ${vencidas.length ? "bg-[#fdeeec] text-danger" : "bg-[#e8f6ed] text-positive"}`}>
                <IconClock className="h-4 w-4" />
              </span>
              <div>
                <h2 className="card-title">
                  Prazos vencidos <span className="ml-1 text-ink-3">{vencidas.length}</span>
                </h2>
                <p className="text-[12px] text-ink-3">O que instrui reiteração e proposta de sanção</p>
              </div>
            </div>
            <Link to={caminhoDaObra(projectId, "nao-conformidades")} className="btn btn-secondary btn-sm">
              Abrir as peças
              <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {vencidas.length === 0 ? (
            <EmptyState icon={<IconCheck className="h-6 w-6" />} title="Nenhum prazo vencido" className="py-8">
              Nenhuma não conformidade com prazo vencido nesta obra.
            </EmptyState>
          ) : (
            vencidas.map((i, idx) => (
              <Link
                key={i.id}
                to={`${caminhoDaObra(projectId, "nao-conformidades")}?nc=${i.id}`}
                className={`group relative grid items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-subtle/70 lg:grid-cols-[120px_1fr_1.1fr_auto] ${
                  idx < vencidas.length - 1 ? "border-b border-line-2" : ""
                }`}
              >
                <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-danger" />
                <span className="font-mono text-[11.5px] font-medium text-ink-3">{i.code}</span>
                <span className="truncate text-[13px] font-semibold text-ink transition group-hover:text-action">{i.title}</span>
                <span className="truncate text-[12.5px] text-ink-2">
                  {nomeNivel(i.levelId)} · {i.discipline} · {NC_STATUS_LABEL[i.ncStatus ?? "rascunho"]}
                </span>
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[#fdeeec] px-2.5 py-1 text-[11.5px] font-semibold text-danger ring-1 ring-inset ring-[#f5d0cb]">
                  <IconClock className="h-3.5 w-3.5" />
                  vencida há {Math.abs(daysLeft(i) ?? 0)} dias
                </span>
              </Link>
            ))
          )}
        </section>

        {/* reincidência */}
        <section className="card reveal mt-5 overflow-hidden" style={{ ["--i" as string]: 8 }}>
          <div className="card-head">
            <div className="flex items-center gap-3">
              <span className={`grid h-9 w-9 place-items-center rounded-xl ${reinc.length ? "bg-[#fdf4e2] text-warn" : "bg-[#e8f6ed] text-positive"}`}>
                <IconRepeat className="h-4 w-4" />
              </span>
              <div>
                <h2 className="card-title">
                  Reincidência <span className="ml-1 text-ink-3">{reinc.length}</span>
                </h2>
                <p className="text-[12px] text-ink-3">Mesma disciplina, mesmo pavimento, em menos de 60 dias</p>
              </div>
            </div>
          </div>
          {reinc.length === 0 ? (
            <EmptyState icon={<IconCheck className="h-6 w-6" />} title="Sem reincidência" className="py-8">
              Nenhum padrão de reincidência identificado no período.
            </EmptyState>
          ) : (
            reinc.map(({ chave, itens }, idx) => {
              const [lvl, disc] = chave.split("|");
              return (
                <div
                  key={chave}
                  className={`px-5 py-4 ${idx < reinc.length - 1 ? "border-b border-line-2" : ""}`}
                >
                  <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">
                    {nomeNivel(lvl)} · {disc}
                    <span className="rounded-full bg-[#fdeeec] px-2 py-0.5 text-[11px] font-semibold text-danger ring-1 ring-inset ring-[#f5d0cb]">
                      {itens.length} ocorrências
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {itens.map((i) => (
                      <Link
                        key={i.id}
                        to={`${caminhoDaObra(projectId, "nao-conformidades")}?nc=${i.id}`}
                        className="inline-flex items-center gap-2 rounded-xl bg-subtle px-3 py-1.5 text-[12px] text-ink-2 ring-1 ring-inset ring-line-2 transition hover:bg-brand-soft hover:text-action hover:ring-[#cfe7fb]"
                      >
                        <span className="font-mono text-[11px] font-medium text-ink-3">{i.code}</span> {i.title}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </section>

        <p className="mt-5 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-3">
          <IconClock className="mt-px h-3.5 w-3.5 shrink-0" />
          Indicadores calculados sobre as não conformidades registradas nesta obra até{" "}
          {fmtDate(TODAY)}. Tempo de reparo conta da notificação ao aceite em campo.
        </p>
      </div>
    </div>
  );
}

function Campo({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-medium text-ink-3">{label}</dt>
      <dd className={`mt-0.5 break-words text-[13px] text-ink ${mono ? "font-mono text-[12.5px]" : ""}`}>{children}</dd>
    </div>
  );
}

function Prazo({ tone, children }: { tone: "danger" | "warn" | "info" | "muted"; children: React.ReactNode }) {
  const cls = {
    danger: "bg-[#fdeeec] text-danger ring-[#f5d0cb]",
    warn: "bg-[#fdf4e2] text-warn ring-[#efdcb0]",
    info: "bg-brand-soft text-action ring-[#cfe7fb]",
    muted: "bg-subtle text-ink-2 ring-line",
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>{children}</span>;
}

const IconRepeat = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d="M17 2l3 3-3 3" />
    <path d="M4 11V9a4 4 0 0 1 4-4h12" />
    <path d="M7 22l-3-3 3-3" />
    <path d="M20 13v2a4 4 0 0 1-4 4H4" />
  </svg>
);

function Kpi({ i, icon, label, value, suffix, sub, tone = "normal" }: {
  i: number; icon: React.ReactNode; label: string; value: number | null; suffix?: string; sub?: string; tone?: "normal" | "danger";
}) {
  return (
    <div className="card reveal group p-4 sm:p-5" style={{ ["--i" as string]: i }}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium text-ink-3">{label}</p>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone === "danger" ? "bg-[#fdeeec] text-danger" : "bg-brand-soft text-action"}`}>
          {icon}
        </span>
      </div>
      <p className={`mt-1.5 font-display text-[30px] font-bold leading-none tracking-[-0.03em] ${tone === "danger" ? "text-danger" : "text-ink"}`}>
        {value === null ? "—" : <CountUp value={value} />}
        {value !== null && suffix && <span className="ml-0.5 text-[18px] text-ink-3">{suffix}</span>}
      </p>
      {sub && <p className={`mt-2 text-[11.5px] font-medium ${tone === "danger" ? "text-danger" : "text-ink-3"}`}>{sub}</p>}
    </div>
  );
}
