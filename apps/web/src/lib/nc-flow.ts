/**
 * A máquina de estados da não conformidade — fonte única do trâmite.
 *
 * Entre um órgão público e a construtora contratada, um apontamento não é uma
 * anotação: é um ato com prazo, base normativa e consequência contratual. Por
 * isso nenhuma tela decide transição por conta própria. Toda ação passa por
 * `apply`, que valida o papel de quem age, exige o que a regra exige (motivo,
 * evidência), grava o evento e recalcula o prazo.
 *
 * Duas escolhas que valem explicar:
 *
 * — **Reprovar não é estado.** É um evento que devolve a NC para `em_reparo` e
 *   incrementa a reincidência. Quem lê o documento precisa ver quantas vezes o
 *   reparo voltou, não encontrar a NC parada num limbo chamado "reprovada".
 *
 * — **Vencida não é estado.** É derivado de `deadline < hoje`. Prazo vencido não
 *   muda a natureza do ato; muda o que a fiscalização pode fazer com ele.
 */
import type {
  Issue,
  IssueSeverity,
  IssueStatus,
  NcAction,
  NcEvent,
  NcEvidence,
  NcEvidenceKind,
  NcRole,
  NcStatus,
} from "../types";
import { TODAY } from "./journey";

/** Prazo de reparo por severidade, em dias corridos. O contrato pode sobrescrever. */
export const PRAZO_PADRAO: Record<IssueSeverity, number> = {
  critica: 2,
  alta: 7,
  media: 15,
  baixa: 30,
};

/** Estados em que a NC ainda cobra alguma coisa de alguém. */
export const ABERTAS: NcStatus[] = [
  "rascunho",
  "notificada",
  "ciente",
  "em_reparo",
  "reparo_submetido",
  "contestada",
];

/**
 * As telas antigas (painel, relatório, RDO) leem `Issue.status`. Mantemos essa
 * leitura grosseira em sincronia com o estado real para não quebrar nada.
 * `cancelada` cai em "resolvido" porque também sai da fila de cobrança — o
 * documento é que diz que foi cancelamento, não solução.
 */
export function statusGrosseiro(nc: NcStatus): IssueStatus {
  switch (nc) {
    case "rascunho":
    case "notificada":
    case "ciente":
      return "aberto";
    case "em_reparo":
      return "em_execucao";
    case "reparo_submetido":
    case "contestada":
      return "aguardando_verificacao";
    case "sanada":
    case "cancelada":
      return "resolvido";
  }
}

export interface Transition {
  action: NcAction;
  label: string;
  /** frase curta do que acontece, para a confirmação */
  effect: string;
  role: NcRole;
  from: NcStatus[];
  to: NcStatus;
  requiresNote?: boolean;
  requiresEvidence?: NcEvidenceKind;
  /** só oferece quando o prazo já venceu */
  onlyOverdue?: boolean;
  /** renova o prazo a partir de hoje */
  renewsDeadline?: boolean;
  tone: "neutral" | "action" | "positive" | "danger";
}

const TRANSITIONS: Transition[] = [
  {
    action: "notificar",
    label: "Notificar construtora",
    effect: "Emite a notificação, inicia a contagem do prazo e envia à construtora.",
    role: "fiscalizacao",
    from: ["rascunho"],
    to: "notificada",
    requiresEvidence: "abertura",
    renewsDeadline: true,
    tone: "action",
  },
  {
    action: "dar_ciencia",
    label: "Dar ciência",
    effect: "Registra o recebimento da notificação, com data e hora.",
    role: "construtora",
    from: ["notificada"],
    to: "ciente",
    tone: "action",
  },
  {
    action: "iniciar_reparo",
    label: "Informar início do reparo",
    effect: "Registra que a equipe entrou no serviço.",
    role: "construtora",
    from: ["notificada", "ciente"],
    to: "em_reparo",
    tone: "neutral",
  },
  {
    action: "submeter_reparo",
    label: "Submeter reparo",
    effect: "Devolve à fiscalização para verificação, com a evidência do serviço feito.",
    role: "construtora",
    from: ["ciente", "em_reparo"],
    to: "reparo_submetido",
    requiresEvidence: "reparo",
    tone: "action",
  },
  {
    action: "contestar",
    label: "Contestar apontamento",
    effect: "Suspende o prazo e leva a divergência ao gestor do contrato.",
    role: "construtora",
    from: ["notificada", "ciente", "em_reparo"],
    to: "contestada",
    requiresNote: true,
    tone: "danger",
  },
  {
    action: "aprovar",
    label: "Aprovar e encerrar",
    effect: "Confirma em campo que o serviço foi sanado e encerra a não conformidade.",
    role: "fiscalizacao",
    from: ["reparo_submetido"],
    to: "sanada",
    requiresEvidence: "verificacao",
    tone: "positive",
  },
  {
    action: "reprovar",
    label: "Reprovar reparo",
    effect: "Devolve à construtora com novo prazo e registra a reincidência.",
    role: "fiscalizacao",
    from: ["reparo_submetido"],
    to: "em_reparo",
    requiresNote: true,
    renewsDeadline: true,
    tone: "danger",
  },
  {
    action: "prorrogar",
    label: "Prorrogar prazo",
    effect: "Concede novo prazo, com a justificativa registrada no histórico.",
    role: "fiscalizacao",
    from: ["notificada", "ciente", "em_reparo"],
    to: "em_reparo",
    requiresNote: true,
    renewsDeadline: true,
    tone: "neutral",
  },
  {
    action: "reiterar",
    label: "Reiterar notificação",
    effect: "Registra o descumprimento do prazo e instrui eventual sanção.",
    role: "fiscalizacao",
    from: ["notificada", "ciente", "em_reparo"],
    to: "em_reparo",
    requiresNote: true,
    onlyOverdue: true,
    tone: "danger",
  },
  {
    action: "cancelar",
    label: "Cancelar apontamento",
    effect: "Encerra sem cobrança, por improcedência. Fica registrado, não some.",
    role: "fiscalizacao",
    from: ["rascunho", "notificada", "ciente", "em_reparo", "reparo_submetido"],
    to: "cancelada",
    requiresNote: true,
    tone: "danger",
  },
  {
    action: "decidir_contestacao",
    label: "Decidir contestação",
    effect: "Procedente cancela o apontamento; improcedente devolve ao reparo com novo prazo.",
    role: "gestor",
    from: ["contestada"],
    to: "em_reparo",
    requiresNote: true,
    renewsDeadline: true,
    tone: "action",
  },
];

export const isOverdue = (nc: Issue, today = TODAY): boolean =>
  Boolean(nc.deadline) && nc.deadline! < today && ABERTAS.includes(nc.ncStatus ?? "rascunho");

/** Dias restantes até o prazo — negativo quando já venceu. */
export function daysLeft(nc: Issue, today = TODAY): number | null {
  if (!nc.deadline) return null;
  const a = new Date(`${today}T00:00:00`).getTime();
  const b = new Date(`${nc.deadline}T00:00:00`).getTime();
  return Math.round((b - a) / 864e5);
}

/** O que este papel pode fazer com esta NC agora. */
export function available(nc: Issue, role: NcRole, today = TODAY): Transition[] {
  const status = nc.ncStatus ?? "rascunho";
  return TRANSITIONS.filter(
    (t) =>
      t.role === role &&
      t.from.includes(status) &&
      (!t.onlyOverdue || isOverdue(nc, today)),
  );
}

export const findTransition = (action: NcAction) =>
  TRANSITIONS.find((t) => t.action === action);

export interface ApplyPayload {
  actor: string;
  role: NcRole;
  note?: string;
  evidence?: NcEvidence;
  /** dias de prazo; quando ausente usa o do contrato para a severidade */
  prazoDias?: number;
  /** só para decidir_contestacao */
  decisao?: "procedente" | "improcedente";
  /** visita em que o ato foi praticado, quando parte do diário de obra */
  rdoId?: string;
  rdoNumber?: number;
  today?: string;
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const addDays = (from: string, days: number) =>
  new Date(new Date(`${from}T00:00:00`).getTime() + days * 864e5).toISOString().slice(0, 10);

export class NcFlowError extends Error {}

/**
 * Aplica uma ação e devolve a NC nova. Lança `NcFlowError` quando a regra não é
 * atendida — o chamador trata isso como validação de formulário, não como bug.
 */
export function apply(nc: Issue, action: NcAction, payload: ApplyPayload): Issue {
  const today = payload.today ?? TODAY;

  // anexar uma imagem já existente não muda o estado, mas é ato: entra na trilha
  if (action === "anexar_evidencia") {
    if (!payload.evidence) throw new NcFlowError("Nenhuma imagem selecionada.");
    const atual = nc.ncStatus ?? "rascunho";
    return {
      ...nc,
      evidences: [...(nc.evidences ?? []), payload.evidence],
      events: [
        ...(nc.events ?? []),
        {
          id: uid("ev"),
          action,
          from: atual,
          to: atual,
          at: new Date().toISOString(),
          actor: payload.actor,
          role: payload.role,
          note: payload.note?.trim() || `Imagem de ${payload.evidence.kind} anexada do acervo da obra.`,
          deadline: nc.deadline,
          rdoId: payload.rdoId,
          rdoNumber: payload.rdoNumber,
        },
      ],
    };
  }

  // corrigir o conteúdo de uma peça já emitida não é edição: é retificação, e
  // a versão anterior fica no histórico para quem auditar comparar
  if (action === "retificar") {
    if (!payload.note?.trim()) throw new NcFlowError("A retificação exige a razão da correção.");
    const atual = nc.ncStatus ?? "rascunho";
    return {
      ...nc,
      events: [
        ...(nc.events ?? []),
        {
          id: uid("ev"),
          action,
          from: atual,
          to: atual,
          at: new Date().toISOString(),
          actor: payload.actor,
          role: payload.role,
          note: payload.note.trim(),
          deadline: nc.deadline,
          rdoId: payload.rdoId,
          rdoNumber: payload.rdoNumber,
        },
      ],
    };
  }

  const t = findTransition(action);
  if (!t) throw new NcFlowError(`Ação desconhecida: ${action}`);

  const from = nc.ncStatus ?? "rascunho";
  if (t.role !== payload.role) {
    throw new NcFlowError(`Esta ação é da ${t.role}, e você está atuando como ${payload.role}.`);
  }
  if (!t.from.includes(from)) {
    throw new NcFlowError(`Não é possível "${t.label.toLowerCase()}" com a NC em ${from}.`);
  }
  if (t.onlyOverdue && !isOverdue(nc, today)) {
    throw new NcFlowError("A reiteração só cabe depois de vencido o prazo.");
  }
  if (t.requiresNote && !payload.note?.trim()) {
    throw new NcFlowError("Esta ação exige uma justificativa por escrito.");
  }
  if (t.requiresEvidence && payload.evidence?.kind !== t.requiresEvidence) {
    throw new NcFlowError("Esta ação exige o registro fotográfico correspondente.");
  }
  // aceitar um reparo do qual não existe registro é o atalho que derruba a peça
  // na auditoria: pode acontecer (a foto veio por e-mail), mas tem de ser dito.
  if (action === "aprovar" && !evidenceTriptych(nc).reparo && !payload.note?.trim()) {
    throw new NcFlowError(
      "Não há registro fotográfico do reparo. Anexe a imagem do serviço executado ou justifique o aceite por escrito.",
    );
  }

  // contestação procedente encerra o apontamento em vez de devolver ao reparo
  let to: NcStatus = t.to;
  if (action === "decidir_contestacao" && payload.decisao === "procedente") to = "cancelada";

  const prazo = payload.prazoDias ?? PRAZO_PADRAO[nc.severity];
  const deadline = t.renewsDeadline && to !== "cancelada" ? addDays(today, prazo) : nc.deadline;

  const event: NcEvent = {
    id: uid("ev"),
    action,
    from,
    to,
    at: new Date().toISOString(),
    actor: payload.actor,
    role: payload.role,
    note: payload.note?.trim() || undefined,
    deadline,
    rdoId: payload.rdoId,
    rdoNumber: payload.rdoNumber,
  };

  const next: Issue = {
    ...nc,
    ncStatus: to,
    status: statusGrosseiro(to),
    deadline,
    events: [...(nc.events ?? []), event],
    evidences: payload.evidence ? [...(nc.evidences ?? []), payload.evidence] : nc.evidences,
    reopenCount: action === "reprovar" ? (nc.reopenCount ?? 0) + 1 : nc.reopenCount ?? 0,
  };

  if (action === "contestar") {
    next.contestation = {
      justificativa: payload.note!.trim(),
      autor: payload.actor,
      criadaEm: new Date().toISOString(),
    };
  }
  if (action === "decidir_contestacao" && next.contestation) {
    next.contestation = {
      ...next.contestation,
      decisao: payload.decisao ?? "improcedente",
      decididaPor: payload.actor,
      decididaEm: new Date().toISOString(),
      fundamento: payload.note?.trim(),
    };
  }

  return next;
}

/** Atos em que a fiscalização se pronunciou sobre o serviço — a antiga verificação. */
export const ATOS_DE_VERIFICACAO: NcAction[] = ["aprovar", "reprovar", "reiterar", "prorrogar"];

export const verificacoes = (nc: Issue) =>
  (nc.events ?? []).filter((e) => ATOS_DE_VERIFICACAO.includes(e.action));

export const ultimaVerificacao = (nc: Issue) => verificacoes(nc).at(-1);

/** O que foi conferido durante uma visita — alimenta o documento do RDO. */
export const verificadaNoRdo = (nc: Issue, rdoId: string) =>
  verificacoes(nc).filter((e) => e.rdoId === rdoId);

/** A imagem mais recente de cada momento — é o que o termo de verificação imprime. */
export function evidenceTriptych(nc: Issue): Record<NcEvidenceKind, NcEvidence | undefined> {
  const last = (k: NcEvidenceKind) => (nc.evidences ?? []).filter((e) => e.kind === k).at(-1);
  return { abertura: last("abertura"), reparo: last("reparo"), verificacao: last("verificacao") };
}

/** De quem se espera a próxima ação. Nulo quando a peça está encerrada. */
export function bolaCom(nc: Issue): NcRole | null {
  switch (nc.ncStatus ?? "rascunho") {
    case "rascunho":
    case "reparo_submetido":
      return "fiscalizacao";
    case "notificada":
    case "ciente":
    case "em_reparo":
      return "construtora";
    case "contestada":
      return "gestor";
    default:
      return null;
  }
}

/** Há quantos dias a peça está parada na mão de quem está agora. */
export function diasNaMao(nc: Issue, today = TODAY): number {
  const ultimo = (nc.events ?? []).at(-1);
  const desde = ultimo ? ultimo.at.slice(0, 10) : nc.createdAt.slice(0, 10);
  const a = new Date(`${desde}T00:00:00`).getTime();
  const b = new Date(`${today}T00:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / 864e5));
}

/** Dias entre a notificação e o encerramento — alimenta o painel do contrato. */
export function repairDays(nc: Issue): number | null {
  const ev = nc.events ?? [];
  const notif = ev.find((e) => e.action === "notificar");
  const fim = ev.find((e) => e.to === "sanada");
  if (!notif || !fim) return null;
  return Math.max(0, Math.round((new Date(fim.at).getTime() - new Date(notif.at).getTime()) / 864e5));
}

/** Número sequencial por obra e ano: NC-2026-014. */
export function nextCode(existing: Issue[], projectId: string, year = new Date().getFullYear()): string {
  const prefix = `NC-${year}-`;
  const used = existing
    .filter((i) => i.projectId === projectId && i.code?.startsWith(prefix))
    .map((i) => Number(i.code!.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}
