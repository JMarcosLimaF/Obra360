import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ISSUE_ORIGIN_LABEL, ISSUE_STATUS_LABEL, type IssueSeverity, type IssueStatus } from "../types";
import { levelsOf } from "../data/catalog";
import { trails } from "../lib/journey";
import { useObraId } from "../obra";
import { useApp } from "../store";
import { EmptyState, IconArrowRight, IconCrosshair, IconSearch, Micro, PageHeader, StatusChip } from "../components/ui";

const TODAY = "2026-08-30";

const SEVERIDADE: Record<IssueSeverity, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  critica: "Crítica",
};

const SEV_DOT: Record<IssueSeverity, string> = {
  baixa: "bg-ink-3/60",
  media: "bg-warn",
  alta: "bg-danger/80",
  critica: "bg-danger",
};

export default function Issues() {
  const projectId = useObraId();
  const allIssues = useApp((s) => s.issues);
  const requestFlyTo = useApp((s) => s.requestFlyTo);
  const rdos = useApp((s) => s.rdos);
  const levels = useMemo(() => levelsOf(projectId), [projectId]);

  const [status, setStatus] = useState<IssueStatus | "todas">("todas");
  const [level, setLevel] = useState("todos");
  const [assignee, setAssignee] = useState("todas");
  const [discipline, setDiscipline] = useState("todas");
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  const issues = allIssues.filter((i) => i.projectId === projectId);
  const assignees = useMemo(() => [...new Set(issues.map((i) => i.assignee))], [issues]);
  const disciplines = useMemo(() => [...new Set(issues.map((i) => i.discipline))], [issues]);

  const filtered = issues.filter(
    (i) =>
      (level === "todos" || i.levelId === level) &&
      (status === "todas" || i.status === status) &&
      (assignee === "todas" || i.assignee === assignee) &&
      (discipline === "todas" || i.discipline === discipline) &&
      (!onlyOverdue || (i.status !== "resolvido" && i.dueDate < TODAY)),
  );

  const sel = "field h-9 w-auto max-w-full py-0 text-[12.5px]";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-5 pb-14 pt-4 lg:px-8">
        <PageHeader
          className="reveal mb-5"
          title={
            <>
              Ocorrências <span className="ml-1 font-semibold tabular text-ink-3">({filtered.length})</span>
            </>
          }
        />

        <div className="card reveal mb-4 flex flex-wrap items-center gap-2 p-3" style={{ ["--i" as string]: 1 }}>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className={sel}>
            <option value="todos">Todos os pavimentos</option>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} className={sel}>
            <option value="todas">Todas as disciplinas</option>
            {disciplines.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={sel}>
            <option value="todas">Todos os responsáveis</option>
            {assignees.map((a) => <option key={a}>{a}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as IssueStatus | "todas")} className={sel}>
            <option value="todas">Todas as situações</option>
            {(Object.keys(ISSUE_STATUS_LABEL) as IssueStatus[]).map((s) => (
              <option key={s} value={s}>{ISSUE_STATUS_LABEL[s]}</option>
            ))}
          </select>
          <label
            className={`ml-auto inline-flex h-9 cursor-pointer select-none items-center gap-2 rounded-[11px] px-3 text-[12.5px] font-semibold ring-1 ring-inset transition-colors duration-200 ${
              onlyOverdue ? "bg-[#fdeeec] text-danger ring-[#f5d0cb]" : "bg-white text-ink-2 ring-line hover:bg-subtle hover:text-ink"
            }`}
          >
            <input
              type="checkbox"
              checked={onlyOverdue}
              onChange={(e) => setOnlyOverdue(e.target.checked)}
              className={onlyOverdue ? "accent-danger" : "accent-action"}
            />
            só vencidas
          </label>
        </div>

        <div className="card reveal overflow-hidden" style={{ ["--i" as string]: 2 }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line-2 bg-subtle/70">
                <tr>
                  {["Não conformidade", "Local", "Disciplina", "Responsável", "Prazo", "Severidade", "Situação", "Origem e trilha"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 font-normal">
                      <Micro>{h}</Micro>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {filtered.map((i, idx) => {
                  const overdue = i.status !== "resolvido" && i.dueDate < TODAY;
                  return (
                    <tr
                      key={i.id}
                      className="reveal transition-colors duration-200 hover:bg-subtle"
                      style={{ ["--i" as string]: Math.min(idx + 3, 12) }}
                    >
                      <td className="max-w-64 px-4 py-3.5">
                        <p className="flex items-center gap-2 truncate text-[13px] font-semibold text-ink">
                          {(i.mp || i.pose) && <IconCrosshair className="h-3.5 w-3.5 shrink-0 text-action" />}
                          {i.title}
                        </p>
                        <p className="mt-0.5 truncate text-[11.5px] text-ink-3">{i.description}</p>
                      </td>
                      <td className="px-4 py-3.5 text-[12.5px] text-ink-2">{i.local}</td>
                      <td className="px-4 py-3.5 text-[12.5px] text-ink-2">{i.discipline}</td>
                      <td className="px-4 py-3.5 text-[12.5px] text-ink-2">{i.assignee}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-[12.5px]">
                        <span
                          className={
                            overdue
                              ? "inline-flex items-center rounded-full bg-[#fdeeec] px-2 py-0.5 font-semibold tabular text-danger ring-1 ring-inset ring-[#f5d0cb]"
                              : "tabular text-ink-2"
                          }
                        >
                          {i.dueDate.slice(5).split("-").reverse().join("/")}{overdue && " · vencida"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-[12.5px] text-ink-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${SEV_DOT[i.severity]}`} />
                          {SEVERIDADE[i.severity]}
                        </span>
                      </td>
                      <td className="px-4 py-3.5"><StatusChip status={i.status} nc={i.ncStatus} /></td>
                      <td className="px-4 py-3.5">
                        <Micro className="block">{ISSUE_ORIGIN_LABEL[i.origin ?? "manual"]}</Micro>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-3">
                          {trails(i, projectId, rdos).map((t) => (
                            <Link
                              key={t.to}
                              to={t.to}
                              onClick={() => { if (t.fly) requestFlyTo(i.id); }}
                              className="group inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold text-action transition-colors hover:text-ink"
                            >
                              {t.label}
                              <IconArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                            </Link>
                          ))}
                          {trails(i, projectId, rdos).length === 0 && <span className="text-ink-3">—</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <EmptyState icon={<IconSearch className="h-6 w-6" />} title="Nenhuma ocorrência neste filtro." className="py-12" />
          )}
        </div>
      </div>
    </div>
  );
}
