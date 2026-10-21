import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../store";
import type { Issue, IssueSeverity, NcEvidence } from "../types";
import { NC_ACTION_LABEL } from "../types";
import { contractorById, levelsOf, projectById } from "../data/catalog";
import { PRAZO_PADRAO, ultimaVerificacao } from "../lib/nc-flow";
import { TODAY } from "../lib/journey";
import EvidenceCapture from "./EvidenceCapture";
import { trails } from "../lib/journey";
import { mpState } from "./MatterportViewer";
import { polygonAreaM2 } from "../lib/matterport";
import { EmptyState, IconArrowRight, IconClock, IconCrosshair, IconPolygon, IconRotate360, IconSpark, Micro, StatusChip } from "./ui";
import { plainPreview } from "./RichText";

const addDays = (from: string, days: number) =>
  new Date(new Date(`${from}T00:00:00`).getTime() + days * 864e5).toISOString().slice(0, 10);

/** Painel lateral do viewer: pendências da obra + histórico de análises de IA. */
export default function IssuePanel({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<"pendencias" | "analises">("pendencias");
  const issues = useApp((s) => s.issues)
    .filter((i) => i.projectId === projectId)
    .sort((a, b) => {
      const ra = a.status === "resolvido" ? 1 : 0;
      const rb = b.status === "resolvido" ? 1 : 0;
      if (ra !== rb) return ra - rb; // abertas primeiro
      return b.createdAt.localeCompare(a.createdAt); // mais recentes no topo
    });
  const analyses = useApp((s) => s.analyses).filter((a) => a.projectId === projectId);
  const pendingAnchor = useApp((s) => s.pendingAnchor);

  const open = issues.filter((i) => i.status !== "resolvido").length;

  const tabBtn = (id: "pendencias" | "analises", label: string, count: number) => (
    <button
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`relative z-10 flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[9px] text-[12px] font-semibold transition-colors duration-200 ${
        tab === id ? "text-ink" : "text-ink-2 hover:text-ink"
      }`}
    >
      <span className="truncate">{label}</span>
      <span
        className={`min-w-[20px] rounded-full px-1.5 py-px text-center text-[10.5px] font-bold tabular transition-colors duration-200 ${
          tab === id ? "bg-brand-soft text-action" : "bg-ink/[0.06] text-ink-3"
        }`}
      >
        {count}
      </span>
    </button>
  );

  return (
    <aside className="flex h-full w-[340px] max-w-[calc(100vw-3.5rem)] shrink-0 flex-col bg-white">
      <div className="shrink-0 border-b border-line-2 p-3">
        <div className="segmented relative flex w-full">
          {/* trilho: o realce desliza para a aba ativa */}
          <span
            aria-hidden
            className="absolute inset-y-1 left-1 w-[calc(50%-6px)] rounded-[9px] bg-white shadow-sm transition-transform duration-300 ease-out-expo"
            style={{ transform: tab === "analises" ? "translateX(calc(100% + 4px))" : "none" }}
          />
          {tabBtn("pendencias", "Não conformidades", open)}
          {tabBtn("analises", "Análises IA", analyses.length)}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "pendencias" ? (
          <div key="pendencias" className="flex flex-col gap-2.5 p-3">
            {pendingAnchor && (
              <div className="overflow-hidden rounded-2xl shadow-md ring-1 ring-[#cfe7fb]">
                <NewIssueForm projectId={projectId} />
              </div>
            )}
            {!pendingAnchor && (
              <p className="reveal rounded-xl bg-brand-soft/60 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-ink-2 ring-1 ring-inset ring-[#cfe7fb]">
                Use <b className="font-semibold text-ink">Marcar local</b> (ponto) ou{" "}
                <b className="font-semibold text-ink">Marcar área</b> (polígono) no tour.
                Peças ancoradas têm o atalho <b className="font-semibold text-ink">ver no tour</b>.
              </p>
            )}
            {issues.map((iss, idx) => (
              <div key={iss.id} className="reveal" style={{ ["--i" as string]: Math.min(idx + 1, 12) }}>
                <IssueCard issue={iss} />
              </div>
            ))}
          </div>
        ) : (
          <div key="analises" className="flex flex-col gap-2.5 p-3">
            {analyses.length === 0 && (
              <EmptyState icon={<IconSpark className="h-6 w-6" />} title="Nenhuma análise ainda." className="reveal">
                Use <b className="font-semibold text-ink">Analisar com IA</b> no tour para gerar uma
                análise da vista atual.
              </EmptyState>
            )}
            {analyses.map((a, idx) => (
              <div
                key={a.id}
                className="card card-hover reveal overflow-hidden rounded-xl"
                style={{ ["--i" as string]: Math.min(idx, 12) }}
              >
                <img src={a.imageDataUrl} alt="" className="block w-full border-b border-line-2 bg-subtle" />
                <div className="p-3.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Micro className="tabular">{new Date(a.createdAt).toLocaleString("pt-BR")}</Micro>
                    {a.simulated && (
                      <span className="rounded-full bg-[#fdf4e2] px-2 py-px text-[10.5px] font-semibold text-warn ring-1 ring-inset ring-[#efdcb0]">
                        simulada
                      </span>
                    )}
                  </div>
                  {a.cameraPos && (
                    <Micro className="block tabular">
                      Câmera ({a.cameraPos.x.toFixed(2)}, {a.cameraPos.y.toFixed(2)}, {a.cameraPos.z.toFixed(2)})
                    </Micro>
                  )}
                  <p className="mb-1 mt-2 text-[12.5px] font-semibold leading-snug text-ink">{a.question}</p>
                  <p className="line-clamp-4 text-[12px] leading-relaxed text-ink-2">
                    {plainPreview(a.result, 260)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Usado no viewer e na visita guiada — a procedência muda conforme quem abre. */
export function NewIssueForm({ projectId, rdoId, levelId: fixedLevel, initialEvidence }: {
  projectId: string;
  /** quando a pendência nasce dentro de uma visita, fica amarrada ao RDO */
  rdoId?: string;
  /** pavimento da frente de serviço em que a visita está */
  levelId?: string;
  /** foto já tirada na frente de serviço, aproveitada como evidência de abertura */
  initialEvidence?: NcEvidence | null;
}) {
  const pendingAnchor = useApp((s) => s.pendingAnchor)!;
  const pendingPolygon = useApp((s) => s.pendingPolygon);
  const setPendingAnchor = useApp((s) => s.setPendingAnchor);
  const pendingShot = useApp((s) => s.pendingShot);
  const setPendingShot = useApp((s) => s.setPendingShot);
  const addIssue = useApp((s) => s.addIssue);
  const areaM2 = pendingPolygon ? polygonAreaM2(pendingPolygon) : undefined;
  const levels = levelsOf(projectId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [levelId, setLevelId] = useState(fixedLevel ?? levels[0]?.id ?? "");
  const [room, setRoom] = useState("");
  const [discipline, setDiscipline] = useState("Alvenaria");
  const contractor = contractorById(projectById(projectId)?.contractorId);
  const [assignee, setAssignee] = useState(contractor?.razaoSocial ?? "Contratada");
  const [severity, setSeverity] = useState<IssueSeverity>("media");
  const [norma, setNorma] = useState("");
  const [evidence, setEvidence] = useState<NcEvidence | null>(initialEvidence ?? pendingShot ?? null);

  // a captura roda em paralelo à marcação; adota a imagem assim que ela chega
  useEffect(() => {
    if (pendingShot && !evidence) setEvidence(pendingShot);
  }, [pendingShot, evidence]);

  // o prazo não é digitado: quem o define é a severidade, pelo contrato
  const prazoDias = projectById(projectId)?.contract?.prazos[severity] ?? PRAZO_PADRAO[severity];
  const dueDate = addDays(TODAY, prazoDias);

  const submit = async () => {
    if (!title.trim() || !evidence) return;
    // a pose é a do instante da marcação; só cai para a atual se não houver
    let pose = evidence.pose;
    if (!pose) {
      try {
        const p = await mpState.sdk?.Camera.getPose();
        if (p?.sweep) pose = { sweep: p.sweep, rotation: p.rotation };
      } catch { /* tour ainda não conectado */ }
    }

    const levelName = levels.find((l) => l.id === levelId)?.name ?? "Tour 360";
    addIssue({
      projectId,
      local: room.trim() ? `${levelName} · ${room.trim()}` : levelName,
      levelId: levelId || undefined,
      origin: rdoId ? "rdo" : "viewer",
      rdoId,
      pose,
      mp: pendingAnchor,
      mpPolygon: pendingPolygon ?? undefined, areaM2,
      norma: norma.trim() || undefined,
      evidences: [evidence],
      title: title.trim(), description, discipline, severity, assignee, dueDate,
    });
    setTitle(""); setDescription(""); setRoom(""); setNorma(""); setEvidence(null); setPendingShot(null);
  };

  return (
    <div className="animate-pop bg-white p-4.5">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-action ring-1 ring-inset ring-[#cfe7fb]">
          {pendingPolygon
            ? <IconPolygon className="h-4 w-4" />
            : <IconCrosshair className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-tight text-ink">
            {pendingPolygon ? "Nova ocorrência em área" : "Nova não conformidade ancorada"}
          </p>
          <Micro className="mt-0.5 block tabular">
            {pendingPolygon
              ? `${pendingPolygon.length} vértices · ~${areaM2!.toFixed(1)} m² · centro (${pendingAnchor.x.toFixed(2)}, ${pendingAnchor.y.toFixed(2)}, ${pendingAnchor.z.toFixed(2)})`
              : `X ${pendingAnchor.x.toFixed(2)} · Y ${pendingAnchor.y.toFixed(2)} · Z ${pendingAnchor.z.toFixed(2)}`}
          </Micro>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título *" className="field font-medium" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição" rows={2} className="field resize-none leading-relaxed" />
        <div className="grid grid-cols-2 gap-2">
          <select value={levelId} onChange={(e) => setLevelId(e.target.value)} className="field text-[12.5px]" aria-label="Pavimento">
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Ambiente" className="field text-[12.5px]" />
        </div>
        <input
          value={norma}
          onChange={(e) => setNorma(e.target.value)}
          placeholder="Fundamento (NBR, NR ou cláusula contratual)"
          className="field"
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} className="field text-[12.5px]">
            {["Alvenaria", "Estrutura", "Elétrica", "Hidráulica", "Acabamento", "Segurança"].map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as IssueSeverity)} className="field text-[12.5px]">
            {(["baixa", "media", "alta", "critica"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="field col-span-2 text-[12.5px]">
            {[contractor?.razaoSocial ?? "Contratada", "Hidrotec Instalações", "Voltec Elétrica", "Equipe própria"].map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
      </div>
      <p className="mb-3 mt-2.5 flex items-start gap-2 rounded-xl bg-subtle px-3 py-2 text-[11.5px] leading-relaxed text-ink-2 ring-1 ring-inset ring-line-2">
        <IconClock className="mt-px h-3.5 w-3.5 shrink-0 text-ink-3" />
        <span>
          Prazo de reparo <b className="font-semibold text-ink">{prazoDias} dias</b> pela severidade — vence em{" "}
          <b className="font-semibold tabular text-ink">{dueDate.split("-").reverse().join("/")}</b>
        </span>
      </p>

      {/* sem imagem não há peça: a NC é um documento probatório */}
      <div className="mb-4">
        <EvidenceCapture
          kind="abertura"
          projectId={projectId}
          hint={{ rdoId, levelId }}
          value={evidence}
          onChange={setEvidence}
        />
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={!title.trim() || !evidence} className="btn btn-primary flex-1">
          {evidence ? "Abrir não conformidade" : "Registre a foto para abrir"}
        </button>
        <button onClick={() => { setPendingShot(null); setPendingAnchor(null); }} className="btn btn-secondary">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function IssueCard({ issue }: { issue: Issue }) {
  const requestFlyTo = useApp((s) => s.requestFlyTo);
  const rdos = useApp((s) => s.rdos);
  const [expanded, setExpanded] = useState(false);
  // a trilha de volta: de onde esta peça veio e como chegar lá
  const back = trails(issue, issue.projectId, rdos).filter((t) => !t.fly);
  const lastCheck = ultimaVerificacao(issue);
  const overdue = issue.status !== "resolvido" && issue.dueDate < "2026-08-30";

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      className={`group cursor-pointer rounded-xl border bg-white p-3.5 transition-[translate,scale,box-shadow,border-color,background-color] duration-300 ease-out-expo hover:-translate-y-0.5 hover:shadow-md ${
        expanded ? "border-[#cfe7fb] shadow-md ring-2 ring-brand/10" : "border-line/80 shadow-xs hover:border-line"
      }`}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-start gap-1.5 text-[13px] font-semibold leading-snug text-ink">
          {issue.mpPolygon
            ? <IconPolygon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-action" />
            : issue.mp && <IconCrosshair className="mt-0.5 h-3.5 w-3.5 shrink-0 text-action" />}
          <span className="min-w-0">{issue.title}</span>
        </h3>
        <StatusChip status={issue.status} nc={issue.ncStatus} />
      </div>
      <p className={`mb-2 text-[12px] leading-relaxed text-ink-2 ${expanded ? "" : "line-clamp-2"}`}>{issue.description}</p>
      <p className={`text-[11.5px] font-medium leading-relaxed ${overdue ? "text-danger" : "text-ink-3"}`}>
        {issue.local} · {issue.discipline}
        {issue.areaM2 && ` · ~${issue.areaM2.toFixed(1)} m²`} · prazo{" "}
        <span className="tabular">{issue.dueDate.slice(5).split("-").reverse().join("/")}</span>
        {overdue && " · vencida"}
      </p>
      <Micro className="block">→ {issue.assignee}</Micro>
      {lastCheck && (
        <Micro className="block">
          {NC_ACTION_LABEL[lastCheck.action]}
          {lastCheck.rdoNumber && ` no RDO nº ${String(lastCheck.rdoNumber).padStart(3, "0")}`} em{" "}
          {new Date(lastCheck.at).toLocaleDateString("pt-BR")}
        </Micro>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line-2 pt-3">
        {(issue.mp || issue.pose) && (
          <button
            onClick={(e) => { e.stopPropagation(); requestFlyTo(issue.id); }}
            className="btn h-7 rounded-lg bg-brand-soft px-2.5 text-[11.5px] text-action ring-1 ring-inset ring-[#cfe7fb] hover:bg-brand hover:text-white hover:ring-brand"
          >
            <IconRotate360 className="h-3.5 w-3.5" />
            Ver no tour
          </button>
        )}
        {back.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            onClick={(e) => e.stopPropagation()}
            className="btn btn-secondary h-7 gap-1 rounded-lg px-2.5 text-[11.5px]"
          >
            <span className="inline-block first-letter:uppercase">{t.label}</span>
            <IconArrowRight className="h-3.5 w-3.5 text-ink-3" />
          </Link>
        ))}
      </div>
    </div>
  );
}
