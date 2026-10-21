import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { contractorById, fmtDate, levelsOf, projectById } from "../data/catalog";
import { caminhoDaObra, useObraId } from "../obra";
import { useApp } from "../store";
import {
  ABERTAS,
  available,
  bolaCom,
  daysLeft,
  diasNaMao,
  evidenceTriptych,
  isOverdue,
  type Transition,
} from "../lib/nc-flow";
import { exportarOficio, exportarPacote, lerPacote } from "../lib/tramitacao";
import type { Issue, NcEvidence, NcEvidenceKind, NcStatus } from "../types";
import { NC_ACTION_LABEL, NC_EVIDENCE_LABEL, NC_ROLE_LABEL } from "../types";
import EvidenceCapture from "../components/EvidenceCapture";
import NcDocument, { NC_DOC_LABEL, type NcDocKind } from "../components/NcDocuments";
import TriagemPanel from "../components/TriagemPanel";
import {
  EmptyState,
  IconAlert,
  IconArrowRight,
  IconCamera,
  IconCheck,
  IconClock,
  IconClose,
  IconCrosshair,
  IconFileText,
  IconPlus,
  IconRotate360,
  IconSearch,
  IconShield,
  IconSpark,
  Micro,
  StatusChip,
} from "../components/ui";

/** Cada papel chega aqui procurando uma coisa diferente. */
const FILA: Record<string, NcStatus[]> = {
  fiscalizacao: ["rascunho", "reparo_submetido"],
  construtora: ["notificada", "ciente", "em_reparo"],
  gestor: ["contestada"],
};

const campoEdit = "field";

/* ícones locais no mesmo traço da grade 24 de ui.tsx */
const traco = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
const IconSend = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg {...traco} className={className}>
    <path d="M21 3L10.5 13.5" />
    <path d="M21 3l-6.5 18-4-7.5-7.5-4L21 3z" />
  </svg>
);
const IconUpload = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg {...traco} className={className}>
    <path d="M12 15V4" />
    <path d="M7.5 8.5L12 4l4.5 4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);
const IconTable = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg {...traco} className={className}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
  </svg>
);
const IconPencil = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg {...traco} className={className}>
    <path d="M4 20l1-4.2L15.8 5a2.1 2.1 0 0 1 3 3L8.2 18.8 4 20z" />
    <path d="M13.8 7l3.2 3.2" />
  </svg>
);
const IconBell = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg {...traco} className={className}>
    <path d="M6 9.5a6 6 0 0 1 12 0c0 5.5 2.5 7 2.5 7h-17S6 15 6 9.5z" />
    <path d="M10 20a2.2 2.2 0 0 0 4 0" />
  </svg>
);

const SEV_LABEL: Record<Issue["severity"], string> = {
  baixa: "Baixa", media: "Média", alta: "Alta", critica: "Crítica",
};

const NcChip = ({ status }: { status: NcStatus }) => (
  <span className="shrink-0"><StatusChip status="aberto" nc={status} /></span>
);

/**
 * O trâmite da não conformidade entre a fiscalização e a construtora.
 *
 * A mesma tela serve aos dois lados: o que muda com o papel ativo não é o que
 * se enxerga — transparência é o produto — e sim o que se pode fazer. Toda ação
 * passa por `lib/nc-flow.ts`, que exige o motivo e a foto que a regra exige.
 */
export default function NaoConformidades() {
  const projectId = useObraId();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const project = projectById(projectId);

  const role = useApp((s) => s.activeRole);
  const user = useApp((s) => s.user) ?? "";
  const allIssues = useApp((s) => s.issues);
  const ncTransition = useApp((s) => s.ncTransition);
  const editIssue = useApp((s) => s.editIssue);
  const mergeIssues = useApp((s) => s.mergeIssues);
  const requestFlyTo = useApp((s) => s.requestFlyTo);
  const requestFlyToPose = useApp((s) => s.requestFlyToPose);

  const issues = useMemo(
    () => allIssues.filter((i) => i.projectId === projectId),
    [allIssues, projectId],
  );
  const levels = useMemo(() => levelsOf(projectId), [projectId]);

  const [filter, setFilter] = useState<"fila" | "abertas" | "vencidas" | "todas">("fila");
  const [busca, setBusca] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doc, setDoc] = useState<NcDocKind | null>(null);
  const [triagem, setTriagem] = useState(false);
  const [pending, setPending] = useState<Transition | null>(null);
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState<NcEvidence | null>(null);
  const [decisao, setDecisao] = useState<"procedente" | "improcedente">("improcedente");
  const [anexarKind, setAnexarKind] = useState<NcEvidenceKind | null>(null);
  const [anexo, setAnexo] = useState<NcEvidence | null>(null);
  const [editando, setEditando] = useState<null | {
    id: string; title: string; description: string; discipline: string;
    severity: Issue["severity"]; norma: string; assignee: string; razao: string;
  }>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const lista = useMemo(() => {
    const base = [...issues].sort((a, b) => {
      const ord = (i: Issue) => (ABERTAS.includes(i.ncStatus ?? "rascunho") ? 0 : 1);
      if (ord(a) !== ord(b)) return ord(a) - ord(b);
      return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
    });
    const q = busca.trim().toLowerCase();
    const casa = (i: Issue) =>
      !q ||
      [i.code, i.title, i.local, i.discipline, i.assignee, i.norma]
        .some((c) => c?.toLowerCase().includes(q));

    if (filter === "todas") return base.filter(casa);
    if (filter === "vencidas") return base.filter((i) => isOverdue(i) && casa(i));
    if (filter === "abertas") return base.filter((i) => ABERTAS.includes(i.ncStatus ?? "rascunho") && casa(i));
    return base.filter((i) => FILA[role].includes(i.ncStatus ?? "rascunho") && casa(i));
  }, [issues, filter, role, busca]);

  const selected = issues.find((i) => i.id === selectedId) ?? lista[0] ?? null;

  // deep link vindo de outro módulo: ?nc=<id>
  useEffect(() => {
    const wanted = params.get("nc");
    if (!wanted || wanted === selectedId) return;
    if (!issues.some((i) => i.id === wanted)) return;
    setSelectedId(wanted);
    setFilter("todas");
    setParams({}, { replace: true });
  }, [params, selectedId, issues, setParams]);

  // trocar de NC ou de papel cancela qualquer ação pela metade
  useEffect(() => {
    setPending(null);
    setNote("");
    setEvidence(null);
    setAnexarKind(null);
    setAnexo(null);
    setErro(null);
  }, [selected?.id, role]);

  if (!project) return null;
  const contractor = contractorById(project.contractorId);

  if (doc && selected) {
    return <NcDocument nc={selected} project={project} kind={doc} onBack={() => setDoc(null)} />;
  }

  if (triagem) {
    return (
      <div className="h-full overflow-y-auto">
        <TriagemPanel
          project={project}
          onOpenNc={(id) => { setSelectedId(id); setFilter("todas"); setTriagem(false); }}
          onClose={() => setTriagem(false)}
        />
      </div>
    );
  }

  const abrirEdicao = (nc: Issue) => {
    setPending(null);
    setErro(null);
    setEditando({
      id: nc.id,
      title: nc.title,
      description: nc.description,
      discipline: nc.discipline,
      severity: nc.severity,
      norma: nc.norma ?? "",
      assignee: nc.assignee,
      razao: "",
    });
  };

  const salvarEdicao = () => {
    if (!editando) return;
    const { id, razao, ...patch } = editando;
    const msg = editIssue(id, { ...patch, norma: patch.norma.trim() || undefined }, razao);
    if (msg) { setErro(msg); return; }
    setEditando(null);
    setErro(null);
    setAviso("Conteúdo da peça atualizado.");
  };

  /** Notificar de uma vez os rascunhos da visita — um a um não escala. */
  const notificarLote = () => {
    const rascunhos = issues.filter((i) => (i.ncStatus ?? "rascunho") === "rascunho");
    let enviadas = 0;
    let semFoto = 0;
    for (const nc of rascunhos) {
      const abertura = evidenceTriptych(nc).abertura;
      if (!abertura) { semFoto++; continue; }
      if (!ncTransition(nc.id, "notificar", { evidence: abertura })) enviadas++;
    }
    setAviso(
      `${enviadas} notificada${enviadas === 1 ? "" : "s"} à contratada` +
        (semFoto ? ` · ${semFoto} sem registro fotográfico, ficaram em rascunho` : ""),
    );
  };

  // aceitar sem a foto do reparo é permitido, mas nunca em silêncio
  const aceiteSemReparo =
    pending?.action === "aprovar" && !!selected && !evidenceTriptych(selected).reparo;

  const confirmar = () => {
    if (!selected || !pending) return;
    const msg = ncTransition(selected.id, pending.action, {
      note: note || undefined,
      evidence: evidence ?? undefined,
      decisao: pending.action === "decidir_contestacao" ? decisao : undefined,
      prazoDias: project.contract?.prazos[selected.severity],
    });
    if (msg) { setErro(msg); return; }
    setPending(null);
    setNote("");
    setEvidence(null);
    setErro(null);
    setAviso(`${pending.label} registrado em ${selected.code}.`);
  };

  const importar = async (file: File) => {
    try {
      const pacote = await lerPacote(file);
      if (pacote.projectId !== projectId) {
        setErro("Este pacote é de outra obra.");
        return;
      }
      const r = mergeIssues(pacote.ncs);
      setAviso(
        `Pacote de ${NC_ROLE_LABEL[pacote.papel].toLowerCase()} importado: ${r.novas} nova(s), ` +
        `${r.atualizadas} atualizada(s).`,
      );
      setErro(null);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível ler o pacote.");
    }
  };

  // cada lado responde por uma etapa do registro fotográfico
  const podeAnexar = (k: NcEvidenceKind) => {
    if (role === "construtora") return k === "reparo";
    if (role !== "fiscalizacao") return false;
    // o reparo é da contratada, mas a foto às vezes chega por e-mail: anexar
    // é permitido, e a autoria fica registrada na própria evidência
    return k !== "reparo" || selected?.ncStatus === "reparo_submetido";
  };

  const contagem = {
    fila: issues.filter((i) => FILA[role].includes(i.ncStatus ?? "rascunho")).length,
    abertas: issues.filter((i) => ABERTAS.includes(i.ncStatus ?? "rascunho")).length,
    vencidas: issues.filter((i) => isOverdue(i)).length,
    todas: issues.length,
    rascunhos: issues.filter((i) => (i.ncStatus ?? "rascunho") === "rascunho").length,
  };

  const tabBtn = (id: typeof filter, label: string, n: number) => {
    const ativo = filter === id;
    const alerta = id === "vencidas" && n > 0;
    return (
      <button
        key={id}
        onClick={() => setFilter(id)}
        aria-pressed={ativo}
        className={`relative flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-[9px] px-3 text-[12.5px] font-semibold transition-colors duration-200 ${
          ativo ? "text-ink" : "text-ink-2 hover:text-ink"
        }`}
      >
        {ativo && (
          <motion.span
            layoutId="nc-filtro-ativo"
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
            className="absolute inset-0 rounded-[9px] bg-white shadow-sm"
          />
        )}
        <span className="relative">{label}</span>
        <span
          className={`relative min-w-[20px] rounded-full px-1.5 py-px text-center text-[10.5px] font-bold tabular transition-colors ${
            alerta ? "bg-[#fdeeec] text-danger" : ativo ? "bg-brand-soft text-action" : "bg-ink/[0.06] text-ink-3"
          }`}
        >
          {n}
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto lg:overflow-hidden">
      {/* barra da obra e do contrato */}
      <div className="shrink-0 border-b border-line bg-white/80 px-4 pb-3 pt-3.5 backdrop-blur-xl sm:px-5 lg:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="mr-auto flex min-w-0 items-center gap-3">
            <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-action ring-1 ring-inset ring-[#cfe7fb] sm:grid">
              <IconAlert className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-[18px] font-bold leading-tight tracking-[-0.02em] text-ink">
                Não conformidades
              </h1>
              <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
                {contractor?.razaoSocial ?? "construtora não cadastrada"}
                {project.contract && ` · contrato ${project.contract.numero}`}
                {project.contract && ` · fiscal ${project.contract.fiscalDesignado}`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {role === "fiscalizacao" && contagem.rascunhos > 0 && (
              <button onClick={notificarLote} className="btn btn-secondary btn-sm">
                <IconBell className="h-3.5 w-3.5 text-ink-3" />
                Notificar {contagem.rascunhos} rascunho{contagem.rascunhos === 1 ? "" : "s"}
              </button>
            )}
            {role === "fiscalizacao" && (
              <button onClick={() => setTriagem(true)} className="btn btn-accent btn-sm">
                <IconSpark className="h-3.5 w-3.5" />
                Triagem por IA
              </button>
            )}
            {role === "fiscalizacao" && <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-line sm:block" />}
            <button
              onClick={() => exportarPacote(lista, project, { emitidoPor: user, papel: role, para: role === "construtora" ? "fiscalizacao" : "construtora" })}
              className="btn btn-secondary btn-sm"
            >
              <IconSend className="h-3.5 w-3.5 text-ink-3" />
              Enviar tramitação <span className="tabular text-ink-3">({lista.length})</span>
            </button>
            <button
              onClick={() => exportarOficio(lista, project, { emitidoPor: user, papel: role, para: role === "construtora" ? "fiscalizacao" : "construtora" })}
              className="btn btn-secondary btn-sm"
            >
              <IconFileText className="h-3.5 w-3.5 text-ink-3" />
              Ofício
            </button>
            <Link to={caminhoDaObra(projectId, "ocorrencias")} className="btn btn-secondary btn-sm">
              <IconTable className="h-3.5 w-3.5 text-ink-3" />
              Tabela
            </Link>
            <button onClick={() => importRef.current?.click()} className="btn btn-secondary btn-sm">
              <IconUpload className="h-3.5 w-3.5 text-ink-3" />
              Importar
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importar(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="-mx-1 mt-3 overflow-x-auto px-1">
          <div className="segmented">
            {tabBtn("fila", `Minha fila — ${NC_ROLE_LABEL[role]}`, contagem.fila)}
            {tabBtn("abertas", "Abertas", contagem.abertas)}
            {tabBtn("vencidas", "Vencidas", contagem.vencidas)}
            {tabBtn("todas", "Todas", contagem.todas)}
          </div>
        </div>

        {(erro || aviso) && (
          <p
            key={erro ?? aviso}
            role="status"
            className={`mt-3 flex animate-pop items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ring-1 ring-inset ${
              erro ? "bg-[#fdeeec] text-danger ring-[#f5d0cb]" : "bg-[#e8f6ed] text-positive ring-[#c4e5d0]"
            }`}
          >
            {erro ? <IconAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1">{erro ?? aviso}</span>
            <button
              onClick={() => { setErro(null); setAviso(null); }}
              className="-my-0.5 shrink-0 rounded-lg px-2 py-0.5 text-[12px] font-semibold underline underline-offset-2 transition hover:bg-white/70"
            >
              ok
            </button>
          </p>
        )}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(320px,380px)_1fr]">
        {/* lista */}
        <div className="min-h-0 border-b border-line bg-white lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="sticky top-0 z-10 border-b border-line-2 bg-white/90 px-3 py-3 backdrop-blur-xl">
            <label className="relative block">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por número, título, local, disciplina ou norma"
                aria-label="Buscar não conformidade"
                className="field h-10 rounded-xl pl-9 text-[12.5px]"
              />
            </label>
            {busca && (
              <Micro className="mt-2 block px-1">
                <span className="tabular">{lista.length}</span> resultado{lista.length === 1 ? "" : "s"} ·{" "}
                <button onClick={() => setBusca("")} className="font-semibold text-action transition hover:text-ink">limpar</button>
              </Micro>
            )}
          </div>
          {lista.length === 0 ? (
            <EmptyState
              icon={filter === "fila" ? <IconCheck className="h-6 w-6" /> : <IconSearch className="h-6 w-6" />}
              title={
                filter === "fila"
                  ? `Nada aguardando a ${NC_ROLE_LABEL[role].toLowerCase()} nesta obra.`
                  : "Nenhuma não conformidade neste filtro."
              }
              className="py-12"
            />
          ) : (
            <div className="space-y-1 p-2">
              {lista.map((nc, idx) => {
                const dias = daysLeft(nc);
                const venc = isOverdue(nc);
                const ativa = selected?.id === nc.id;
                return (
                  <button
                    key={nc.id}
                    onClick={() => setSelectedId(nc.id)}
                    aria-current={ativa ? "true" : undefined}
                    className={`reveal relative block w-full overflow-hidden rounded-xl px-3.5 py-3 text-left transition-[background-color,box-shadow] duration-200 ${
                      ativa ? "bg-brand-soft/70 ring-1 ring-inset ring-[#cfe7fb]" : "hover:bg-subtle"
                    }`}
                    style={{ ["--i" as string]: Math.min(idx, 12) }}
                  >
                    {venc && <span aria-hidden className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-danger" />}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-[11.5px] font-medium text-ink-3">{nc.code}</span>
                      <NcChip status={nc.ncStatus ?? "rascunho"} />
                      {(nc.reopenCount ?? 0) > 0 && (
                        <span className="rounded-full bg-[#fdeeec] px-2 py-px text-[10.5px] font-semibold text-danger ring-1 ring-inset ring-[#f5d0cb]">
                          {nc.reopenCount}× reprovado
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-[13.5px] font-semibold tracking-[-0.005em] text-ink">{nc.title}</p>
                    <Micro className="mt-0.5 block truncate">
                      {nc.local} · {nc.discipline} · {SEV_LABEL[nc.severity]}
                    </Micro>
                    {bolaCom(nc) && (
                      <Micro className="block">
                        com a {NC_ROLE_LABEL[bolaCom(nc)!].toLowerCase()} há {diasNaMao(nc)} dia
                        {diasNaMao(nc) === 1 ? "" : "s"}
                      </Micro>
                    )}
                    {nc.deadline && ABERTAS.includes(nc.ncStatus ?? "rascunho") && (
                      <p
                        className={`mt-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold ${
                          venc ? "text-danger" : dias !== null && dias <= 2 ? "text-warn" : "text-ink-3"
                        }`}
                      >
                        <IconClock className="h-3.5 w-3.5 shrink-0" />
                        {venc
                          ? `vencida há ${Math.abs(dias ?? 0)} dia${Math.abs(dias ?? 0) === 1 ? "" : "s"}`
                          : `prazo ${fmtDate(nc.deadline)} · ${dias} dia${dias === 1 ? "" : "s"}`}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* detalhe */}
        <div className="min-h-0 lg:overflow-y-auto">
          {!selected ? (
            <EmptyState
              icon={<IconFileText className="h-6 w-6" />}
              title="Selecione uma não conformidade."
              className="py-24"
            />
          ) : (
            <div key={selected.id} className="mx-auto max-w-3xl px-4 pb-12 pt-6 sm:px-6 lg:pt-7">
              <header
                className="reveal mb-5 flex flex-wrap items-start justify-between gap-4"
                style={{ ["--i" as string]: 0 }}
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-white px-2 py-0.5 font-mono text-[11.5px] font-medium text-ink-2 shadow-xs ring-1 ring-inset ring-line">
                      {selected.code}
                    </span>
                    <NcChip status={selected.ncStatus ?? "rascunho"} />
                  </div>
                  <h2 className="font-display text-[20px] font-bold leading-snug tracking-[-0.02em] text-ink">
                    {selected.title}
                  </h2>
                  {bolaCom(selected) && (
                    <p className="mt-2.5 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[12px] text-ink-2 shadow-xs ring-1 ring-inset ring-line">
                      <span aria-hidden className="relative flex h-1.5 w-1.5">
                        <span className="absolute inset-0 animate-ping rounded-full bg-brand opacity-60" />
                        <span className="relative h-1.5 w-1.5 rounded-full bg-brand" />
                      </span>
                      <span>
                        Aguardando <b className="font-semibold text-ink">{NC_ROLE_LABEL[bolaCom(selected)!].toLowerCase()}</b>{" "}
                        há {diasNaMao(selected)} dia{diasNaMao(selected) === 1 ? "" : "s"}
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => abrirEdicao(selected)} className="btn btn-secondary">
                    <IconPencil className="h-4 w-4 text-ink-3" />
                    {(selected.ncStatus ?? "rascunho") === "rascunho" ? "Editar" : "Retificar"}
                  </button>
                  {(selected.mp || selected.pose) && (
                    <button
                      onClick={() => { requestFlyTo(selected.id); navigate(caminhoDaObra(projectId, "tour")); }}
                      className="btn btn-primary"
                    >
                      <IconRotate360 className="h-4 w-4" />
                      Ver no tour
                    </button>
                  )}
                </div>
              </header>

              {editando?.id === selected.id && (
                <div className="card mb-5 animate-pop overflow-hidden">
                  <div className="card-head">
                    <p className="card-title flex items-center gap-2">
                      <IconPencil className="h-4 w-4 text-action" />
                      {(selected.ncStatus ?? "rascunho") === "rascunho"
                        ? "Editar rascunho"
                        : "Retificar peça emitida"}
                    </p>
                  </div>
                  <div className="space-y-2.5 p-5">
                    {(selected.ncStatus ?? "rascunho") !== "rascunho" && (
                      <p className="rounded-xl bg-brand-soft/70 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-2 ring-1 ring-inset ring-[#cfe7fb]">
                        A peça já produziu efeito: a correção não apaga o que foi emitido, entra no
                        histórico como retificação, com a razão informada.
                      </p>
                    )}
                    <input
                      value={editando.title}
                      onChange={(e) => setEditando({ ...editando, title: e.target.value })}
                      placeholder="Título"
                      className={campoEdit}
                    />
                    <textarea
                      rows={3}
                      value={editando.description}
                      onChange={(e) => setEditando({ ...editando, description: e.target.value })}
                      placeholder="Descrição do desvio"
                      className={campoEdit}
                    />
                    <input
                      value={editando.norma}
                      onChange={(e) => setEditando({ ...editando, norma: e.target.value })}
                      placeholder="Fundamento (NBR, NR ou cláusula contratual)"
                      className={campoEdit}
                    />
                    <div className="grid gap-2.5 sm:grid-cols-3">
                      <select
                        value={editando.discipline}
                        onChange={(e) => setEditando({ ...editando, discipline: e.target.value })}
                        className={campoEdit}
                      >
                        {["Alvenaria", "Estrutura", "Elétrica", "Hidráulica", "Acabamento", "Segurança"].map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                      <select
                        value={editando.severity}
                        disabled={(selected.ncStatus ?? "rascunho") !== "rascunho"}
                        onChange={(e) => setEditando({ ...editando, severity: e.target.value as Issue["severity"] })}
                        className={campoEdit}
                        title={(selected.ncStatus ?? "rascunho") !== "rascunho" ? "A severidade define o prazo já notificado; use prorrogar" : undefined}
                      >
                        {(["baixa", "media", "alta", "critica"] as const).map((sv) => (
                          <option key={sv} value={sv}>{SEV_LABEL[sv]}</option>
                        ))}
                      </select>
                      <input
                        value={editando.assignee}
                        onChange={(e) => setEditando({ ...editando, assignee: e.target.value })}
                        placeholder="Responsável"
                        className={campoEdit}
                      />
                    </div>
                    {(selected.ncStatus ?? "rascunho") !== "rascunho" && (
                      <input
                        value={editando.razao}
                        onChange={(e) => setEditando({ ...editando, razao: e.target.value })}
                        placeholder="Razão da retificação (obrigatória)"
                        className={campoEdit}
                      />
                    )}
                    <div className="flex gap-2 pt-1.5">
                      <button
                        onClick={salvarEdicao}
                        disabled={!editando.title.trim()}
                        className="btn btn-primary"
                      >
                        Salvar
                      </button>
                      <button
                        onClick={() => { setEditando(null); setErro(null); }}
                        className="btn btn-ghost"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* prazo */}
              {selected.deadline && ABERTAS.includes(selected.ncStatus ?? "rascunho") && (
                <div
                  className={`reveal mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl px-4 py-3 text-[12.5px] ring-1 ring-inset ${
                    isOverdue(selected)
                      ? "bg-[#fdeeec] text-danger ring-[#f5d0cb]"
                      : "bg-white text-ink-2 shadow-xs ring-line"
                  }`}
                  style={{ ["--i" as string]: 1 }}
                >
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
                      isOverdue(selected) ? "bg-white/70" : "bg-brand-soft text-action"
                    }`}
                  >
                    <IconClock className="h-4 w-4" />
                  </span>
                  <b className={`font-semibold ${isOverdue(selected) ? "" : "text-ink"}`}>
                    Prazo de reparo {fmtDate(selected.deadline)}
                  </b>
                  <span className="tabular">
                    {isOverdue(selected)
                      ? `vencido há ${Math.abs(daysLeft(selected) ?? 0)} dias`
                      : `${daysLeft(selected)} dias restantes`}
                  </span>
                  <span className="text-ink-3">
                    severidade {SEV_LABEL[selected.severity].toLowerCase()}
                  </span>
                </div>
              )}

              {/* identificação */}
              <section className="card reveal mb-5 p-5" style={{ ["--i" as string]: 2 }}>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                  <Campo label="Pavimento">{levels.find((l) => l.id === selected.levelId)?.name ?? "—"}</Campo>
                  <Campo label="Local">{selected.local}</Campo>
                  <Campo label="Disciplina">{selected.discipline}</Campo>
                  <Campo label="Responsável">{selected.assignee}</Campo>
                  <Campo label="Fundamento">{selected.norma ?? "—"}</Campo>
                  <Campo label="Reincidências">{selected.reopenCount ?? 0}</Campo>
                </div>
                <p className="mt-5 border-t border-line-2 pt-4 text-[13.5px] leading-relaxed text-ink-2">
                  {selected.description}
                </p>
              </section>

              {/* evidências */}
              <section className="card reveal mb-5 overflow-hidden" style={{ ["--i" as string]: 3 }}>
                <div className="card-head">
                  <h3 className="card-title flex items-center gap-2">
                    <IconCamera className="h-4 w-4 text-ink-3" />
                    Registro fotográfico
                  </h3>
                </div>
                <div className="p-5">
                  {selected.ncStatus === "reparo_submetido" && !evidenceTriptych(selected).reparo && (
                    <p className="mb-4 flex items-start gap-2.5 rounded-xl bg-[#fdf4e2] px-3.5 py-2.5 text-[12px] leading-relaxed text-warn ring-1 ring-inset ring-[#efdcb0]">
                      <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        Reparo submetido sem registro fotográfico. Anexe a imagem do serviço executado
                        ou justifique o aceite por escrito — sem isso a peça não se sustenta em auditoria.
                      </span>
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
                    {(["abertura", "reparo", "verificacao"] as const).map((k) => {
                      const ev = evidenceTriptych(selected)[k];
                      return (
                        <figure key={k} className="min-w-0">
                          {ev ? (
                            <>
                              <div className="group/foto relative aspect-[4/3] overflow-hidden rounded-xl bg-subtle ring-1 ring-line">
                                <img
                                  src={ev.imageDataUrl}
                                  alt=""
                                  className="h-full w-full object-cover transition-transform duration-700 ease-out-expo group-hover/foto:scale-[1.06]"
                                />
                              </div>
                              {ev.pose && (
                                <button
                                  onClick={() => { requestFlyToPose(ev.pose!); navigate(caminhoDaObra(projectId, "tour")); }}
                                  className="group/vista mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-action transition hover:text-ink"
                                >
                                  ir a esta vista
                                  <IconArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover/vista:translate-x-0.5" />
                                </button>
                              )}
                            </>
                          ) : (
                            <div className="flex aspect-[4/3] overflow-hidden rounded-xl border border-dashed border-field bg-subtle/70 text-center text-[11.5px] text-ink-3">
                              {podeAnexar(k) ? (
                                <button
                                  onClick={() => { setAnexarKind(k); setAnexo(null); setErro(null); }}
                                  className="group/anexar flex flex-1 flex-col items-center justify-center gap-1.5 px-2 font-semibold text-action transition-colors duration-200 hover:bg-brand-soft/70 hover:text-ink"
                                >
                                  <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-xs ring-1 ring-inset ring-line transition-transform duration-300 group-hover/anexar:scale-110">
                                    <IconPlus className="h-4 w-4" />
                                  </span>
                                  anexar imagem
                                </button>
                              ) : (
                                <span className="flex flex-1 flex-col items-center justify-center gap-1.5 px-2">
                                  <IconCamera className="h-5 w-5 opacity-60" />
                                  sem registro
                                </span>
                              )}
                            </div>
                          )}
                          <figcaption className="mt-1.5">
                            <p className="truncate text-[12px] font-semibold text-ink">
                              {NC_EVIDENCE_LABEL[k]}
                              {ev && (
                                <span className="font-medium text-ink-3">
                                  {` · ${new Date(ev.createdAt).toLocaleDateString("pt-BR")}`}
                                </span>
                              )}
                            </p>
                            {ev?.note && <p className="mt-0.5 text-[11.5px] leading-snug text-ink-2">{ev.note}</p>}
                          </figcaption>
                        </figure>
                      );
                    })}
                  </div>

                  {anexarKind && (
                    <div className="mt-5 animate-pop rounded-xl bg-subtle p-4 ring-1 ring-inset ring-line-2">
                      <p className="mb-3 text-[13px] font-semibold text-ink">
                        Anexar imagem de {NC_EVIDENCE_LABEL[anexarKind].toLowerCase()}
                      </p>
                      <EvidenceCapture
                        kind={anexarKind}
                        suggestedPose={evidenceTriptych(selected).abertura?.pose ?? selected.pose}
                        projectId={projectId}
                        hint={{ rdoId: selected.rdoId, levelId: selected.levelId }}
                        value={anexo}
                        onChange={setAnexo}
                      />
                      <div className="mt-3 flex gap-2">
                        <button
                          disabled={!anexo}
                          onClick={() => {
                            const msg = ncTransition(selected.id, "anexar_evidencia", { evidence: anexo! });
                            if (msg) { setErro(msg); return; }
                            setAnexarKind(null);
                            setAnexo(null);
                            setAviso(`Imagem de ${NC_EVIDENCE_LABEL[anexarKind].toLowerCase()} anexada a ${selected.code}.`);
                          }}
                          className="btn btn-primary"
                        >
                          Anexar
                        </button>
                        <button
                          onClick={() => { setAnexarKind(null); setAnexo(null); }}
                          className="btn btn-ghost"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* contestação */}
              {selected.contestation && (
                <section className="card reveal relative mb-5 overflow-hidden p-5 pl-6" style={{ ["--i" as string]: 4 }}>
                  <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-danger" />
                  <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-danger">
                    <IconAlert className="h-4 w-4" />
                    Contestação da contratada
                  </p>
                  <p className="text-[13.5px] leading-relaxed text-ink-2">
                    {selected.contestation.justificativa}
                  </p>
                  <Micro className="mt-2 block">
                    {selected.contestation.autor} ·{" "}
                    {new Date(selected.contestation.criadaEm).toLocaleString("pt-BR")}
                    {selected.contestation.decisao &&
                      ` · decidida ${selected.contestation.decisao} por ${selected.contestation.decididaPor}`}
                  </Micro>
                </section>
              )}

              {/* ações do papel ativo */}
              <section className="card reveal mb-5 overflow-hidden" style={{ ["--i" as string]: 5 }}>
                <div className="card-head">
                  <h3 className="card-title flex items-center gap-2">
                    <IconShield className="h-4 w-4 text-ink-3" />
                    Ações disponíveis — {NC_ROLE_LABEL[role]}
                  </h3>
                  {pending && (
                    <button
                      onClick={() => { setPending(null); setErro(null); }}
                      aria-label="Cancelar ação"
                      className="-my-1 grid h-8 w-8 place-items-center rounded-lg text-ink-3 transition hover:bg-ink/5 hover:text-ink"
                    >
                      <IconClose className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="p-5">
                  {!pending ? (
                    <div className="flex animate-fade flex-wrap gap-2">
                      {available(selected, role).map((t) => (
                        <button
                          key={t.action}
                          onClick={() => { setPending(t); setNote(""); setEvidence(null); setErro(null); }}
                          className={`btn ${
                            t.tone === "positive" ? "btn-secondary text-positive hover:border-positive/40 hover:bg-positive/[0.06]"
                            : t.tone === "danger" ? "btn-secondary text-danger hover:border-danger/40 hover:bg-danger/[0.06]"
                            : t.tone === "action" ? "btn-accent"
                            : "btn-secondary"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                      {available(selected, role).length === 0 && (
                        <p className="text-[12.5px] leading-relaxed text-ink-3">
                          Nada a fazer aqui como {NC_ROLE_LABEL[role].toLowerCase()}. Troque o papel no
                          topo da tela para ver o outro lado do trâmite.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="animate-pop space-y-3.5">
                      <div>
                        <p className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{pending.label}</p>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{pending.effect}</p>
                      </div>

                      {pending.action === "decidir_contestacao" && (
                        <div className="segmented">
                          {(["improcedente", "procedente"] as const).map((d) => (
                            <button
                              key={d}
                              onClick={() => setDecisao(d)}
                              aria-pressed={decisao === d}
                              className={`h-8 rounded-[9px] px-3 text-[12px] font-semibold transition-[background-color,color,box-shadow] duration-200 ${
                                decisao === d ? "bg-white text-ink shadow-sm" : "text-ink-2 hover:text-ink"
                              }`}
                            >
                              contestação {d}
                            </button>
                          ))}
                        </div>
                      )}

                      {pending.requiresEvidence && (
                        <EvidenceCapture
                          kind={pending.requiresEvidence}
                          suggestedPose={evidenceTriptych(selected).abertura?.pose ?? selected.pose}
                          projectId={projectId}
                          hint={{ rdoId: selected.rdoId, levelId: selected.levelId }}
                          value={evidence}
                          onChange={setEvidence}
                        />
                      )}

                      {aceiteSemReparo && (
                        <p className="flex items-start gap-2.5 rounded-xl bg-[#fdf4e2] px-3.5 py-2.5 text-[12px] leading-relaxed text-warn ring-1 ring-inset ring-[#efdcb0]">
                          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            Esta peça não tem registro fotográfico do reparo. O aceite é possível, mas
                            exige que você diga por escrito em que se baseou.
                          </span>
                        </p>
                      )}
                      <textarea
                        rows={3}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={
                          aceiteSemReparo
                            ? "Em que se baseia o aceite sem o registro do reparo (obrigatório)"
                            : pending.requiresNote
                              ? "Justificativa (obrigatória) — o que motivou este ato"
                              : "Observação (opcional)"
                        }
                        className="field"
                      />

                      <div className="flex gap-2">
                        <button
                          onClick={confirmar}
                          disabled={(pending.requiresNote || aceiteSemReparo) && !note.trim()}
                          className="btn btn-primary"
                        >
                          <IconCheck className="h-4 w-4" />
                          Confirmar
                        </button>
                        <button
                          onClick={() => { setPending(null); setErro(null); }}
                          className="btn btn-ghost"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* documentos */}
              <section className="card reveal mb-5 overflow-hidden" style={{ ["--i" as string]: 6 }}>
                <div className="card-head">
                  <h3 className="card-title flex items-center gap-2">
                    <IconFileText className="h-4 w-4 text-ink-3" />
                    Peças do processo
                  </h3>
                </div>
                <div className="grid gap-2.5 p-5 sm:grid-cols-2">
                  {(Object.keys(NC_DOC_LABEL) as NcDocKind[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => setDoc(k)}
                      className="group flex items-center gap-3 rounded-xl bg-subtle px-3.5 py-3 text-left ring-1 ring-inset ring-line-2 transition-[background-color,box-shadow] duration-200 hover:bg-white hover:shadow-sm hover:ring-line"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-action shadow-xs ring-1 ring-inset ring-line transition-transform duration-300 group-hover:scale-105">
                        <IconFileText className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-ink">
                        {NC_DOC_LABEL[k]}
                      </span>
                      <IconArrowRight className="h-4 w-4 shrink-0 text-ink-3 transition-[translate,color] duration-300 group-hover:translate-x-0.5 group-hover:text-action" />
                    </button>
                  ))}
                </div>
              </section>

              {/* histórico */}
              <section className="card reveal overflow-hidden" style={{ ["--i" as string]: 7 }}>
                <div className="card-head">
                  <h3 className="card-title flex items-center gap-2">
                    <IconClock className="h-4 w-4 text-ink-3" />
                    Histórico da tramitação
                  </h3>
                  {(selected.events ?? []).length > 0 && (
                    <span className="min-w-[22px] rounded-full bg-ink/[0.06] px-1.5 py-px text-center text-[11px] font-bold tabular text-ink-3">
                      {(selected.events ?? []).length}
                    </span>
                  )}
                </div>
                <div className="p-5">
                  {(selected.events ?? []).length === 0 ? (
                    <p className="text-[12.5px] text-ink-3">Sem eventos registrados.</p>
                  ) : (
                    <ol>
                      {(selected.events ?? []).map((e, i, todos) => {
                        const ultimo = i === todos.length - 1;
                        return (
                          <li key={e.id} className="relative flex gap-3.5 pb-5 last:pb-0">
                            {!ultimo && (
                              <span aria-hidden className="absolute -bottom-px left-[7px] top-[23px] w-px bg-line" />
                            )}
                            <span
                              aria-hidden
                              className={`relative mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full bg-white ring-2 ${
                                ultimo ? "ring-brand/30" : "ring-line"
                              }`}
                            >
                              <span className={`h-[7px] w-[7px] rounded-full ${ultimo ? "bg-brand" : "bg-action/55"}`} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold text-ink">
                                {NC_ACTION_LABEL[e.action]}
                                <span className="text-[11.5px] font-medium tabular text-ink-3">
                                  {new Date(e.at).toLocaleString("pt-BR")}
                                </span>
                              </p>
                              <Micro className="mt-0.5 block">
                                {e.actor} · {NC_ROLE_LABEL[e.role]}
                                {e.deadline && ` · prazo ${fmtDate(e.deadline)}`}
                              </Micro>
                              {e.note && (
                                <p className="mt-2 rounded-xl bg-subtle px-3 py-2 text-[12.5px] leading-relaxed text-ink-2 ring-1 ring-inset ring-line-2">
                                  {e.note}
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <Micro className="block">{label}</Micro>
      <p className="mt-0.5 truncate text-[13.5px] font-medium text-ink">{children}</p>
    </div>
  );
}

/** Reexportado para o painel do contrato usar o mesmo desenho de chip. */
export { NcChip, IconCrosshair };
