/**
 * A máquina de estados da não conformidade — agora do lado do servidor.
 *
 * Espelha `apps/web/src/lib/nc-flow.ts`: mesma tabela de transições, mesmas
 * mensagens, mesmas duas escolhas de modelagem —
 *   — reprovar não é estado: devolve para `em_reparo` e soma a reincidência;
 *   — vencida não é estado: é `deadline < hoje`.
 * Um teste (test/nc-flow.parity.test.ts) roda as duas versões lado a lado e
 * falha se uma divergir da outra.
 *
 * A diferença é quem manda. No navegador o módulo só diz o que oferecer na tela;
 * aqui `apply` é a ÚNICA porta do trâmite. É pura (sem banco): recebe o estado
 * atual e o ato, devolve o estado novo, o evento e a evidência. Quem grava é
 * `services/issues.ts`, numa transação marcada para o gatilho do banco aceitar.
 *
 * O servidor também decide o que antes só a tela decidia: o papel vem da sessão
 * (não do cliente), o prazo vem do contrato, e anexar/retificar têm dono.
 */
import type {
  IssueSeverity,
  IssueStatus,
  NcAction,
  NcContestation,
  NcEvidenceKind,
  NcRole,
  NcStatus,
  TourPose,
} from "./types.ts";

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

/** A leitura grosseira das telas antigas (o gatilho do banco calcula a mesma). */
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
  role: NcRole;
  from: NcStatus[];
  to: NcStatus;
  requiresNote?: boolean;
  requiresEvidence?: NcEvidenceKind;
  onlyOverdue?: boolean;
  renewsDeadline?: boolean;
}

export const TRANSITIONS: Transition[] = [
  { action: "notificar", label: "Notificar construtora", role: "fiscalizacao", from: ["rascunho"], to: "notificada", requiresEvidence: "abertura", renewsDeadline: true },
  { action: "dar_ciencia", label: "Dar ciência", role: "construtora", from: ["notificada"], to: "ciente" },
  { action: "iniciar_reparo", label: "Informar início do reparo", role: "construtora", from: ["notificada", "ciente"], to: "em_reparo" },
  { action: "submeter_reparo", label: "Submeter reparo", role: "construtora", from: ["ciente", "em_reparo"], to: "reparo_submetido", requiresEvidence: "reparo" },
  { action: "contestar", label: "Contestar apontamento", role: "construtora", from: ["notificada", "ciente", "em_reparo"], to: "contestada", requiresNote: true },
  { action: "aprovar", label: "Aprovar e encerrar", role: "fiscalizacao", from: ["reparo_submetido"], to: "sanada", requiresEvidence: "verificacao" },
  { action: "reprovar", label: "Reprovar reparo", role: "fiscalizacao", from: ["reparo_submetido"], to: "em_reparo", requiresNote: true, renewsDeadline: true },
  { action: "prorrogar", label: "Prorrogar prazo", role: "fiscalizacao", from: ["notificada", "ciente", "em_reparo"], to: "em_reparo", requiresNote: true, renewsDeadline: true },
  { action: "reiterar", label: "Reiterar notificação", role: "fiscalizacao", from: ["notificada", "ciente", "em_reparo"], to: "em_reparo", requiresNote: true, onlyOverdue: true },
  { action: "cancelar", label: "Cancelar apontamento", role: "fiscalizacao", from: ["rascunho", "notificada", "ciente", "em_reparo", "reparo_submetido"], to: "cancelada", requiresNote: true },
  { action: "decidir_contestacao", label: "Decidir contestação", role: "gestor", from: ["contestada"], to: "em_reparo", requiresNote: true, renewsDeadline: true },
];

export const findTransition = (action: NcAction) => TRANSITIONS.find((t) => t.action === action);

/** O que o trâmite precisa saber da NC para decidir. */
export interface NcState {
  ncStatus: NcStatus;
  severity: IssueSeverity;
  deadline?: string | null;
  reopenCount: number;
  /** só o tipo importa para a regra (tríptico abertura/reparo/verificação) */
  evidenceKinds: NcEvidenceKind[];
  contestation?: NcContestation | null;
}

/** A imagem que acompanha o ato. O servidor guarda os bytes; aqui só a regra. */
export interface EvidenceInput {
  kind: NcEvidenceKind;
  /** data URL nova ou URL de arquivo que a própria API já guardou */
  image: string;
  pose?: TourPose;
  note?: string;
  takenAt?: string;
}

export interface ApplyPayload {
  actor: string;
  role: NcRole;
  note?: string;
  evidence?: EvidenceInput;
  /** prazo do contrato para a severidade desta NC (o servidor calcula) */
  prazoDias?: number;
  decisao?: "procedente" | "improcedente";
  rdoId?: string;
  rdoNumber?: number;
  /** "hoje" do negócio, aaaa-mm-dd */
  today: string;
  /** instante do ato, ISO */
  now: string;
}

export interface EventDraft {
  action: NcAction;
  from?: NcStatus;
  to: NcStatus;
  at: string;
  actor: string;
  role: NcRole;
  note?: string;
  deadline?: string;
  rdoId?: string;
  rdoNumber?: number;
}

export interface ApplyResult {
  next: {
    ncStatus: NcStatus;
    status: IssueStatus;
    deadline?: string;
    reopenCount: number;
    contestation?: NcContestation;
  };
  event: EventDraft;
  evidence?: EvidenceInput;
}

/** Erro de regra do trâmite — vira 422 com a mensagem para a tela. */
export class NcFlowError extends Error {
  readonly code = "transicao_invalida";
}

export const isOverdue = (nc: Pick<NcState, "deadline" | "ncStatus">, today: string): boolean =>
  Boolean(nc.deadline) && nc.deadline! < today && ABERTAS.includes(nc.ncStatus);

export const addDays = (from: string, days: number) =>
  new Date(new Date(`${from}T00:00:00Z`).getTime() + days * 864e5).toISOString().slice(0, 10);

/** O que este papel pode fazer com esta NC agora (mesma regra da tela). */
export function available(nc: NcState, role: NcRole, today: string): Transition[] {
  return TRANSITIONS.filter(
    (t) => t.role === role && t.from.includes(nc.ncStatus) && (!t.onlyOverdue || isOverdue(nc, today)),
  );
}

/**
 * Cada lado responde por uma etapa do registro fotográfico. Na tela isto era só
 * o que se oferecia; aqui é regra: a construtora anexa o reparo, a fiscalização
 * anexa abertura e verificação — e o reparo também quando a foto chegou por
 * e-mail com a peça já submetida (a autoria fica na própria evidência).
 */
export function podeAnexar(role: NcRole, kind: NcEvidenceKind, status: NcStatus): boolean {
  if (role === "construtora") return kind === "reparo";
  if (role !== "fiscalizacao") return false;
  return kind !== "reparo" || status === "reparo_submetido";
}

/**
 * Aplica um ato e devolve o estado novo. `nc` nulo só vale para `abertura` — o
 * nascimento da peça também é ato, e passa por aqui como os outros.
 * Lança `NcFlowError` quando a regra não é atendida.
 */
export function apply(nc: NcState | null, action: NcAction, payload: ApplyPayload): ApplyResult {
  const { today, now } = payload;
  const note = payload.note?.trim() || undefined;

  // a peça nasce em rascunho, assinada por quem a abriu — nunca por um robô
  if (action === "abertura") {
    if (nc) throw new NcFlowError("Esta não conformidade já foi aberta.");
    if (payload.role !== "fiscalizacao") {
      throw new NcFlowError(`Quem abre não conformidade é a fiscalização, e você está atuando como ${payload.role}.`);
    }
    return {
      next: { ncStatus: "rascunho", status: statusGrosseiro("rascunho"), reopenCount: 0 },
      event: { action, to: "rascunho", at: now, actor: payload.actor, role: payload.role, note, rdoId: payload.rdoId, rdoNumber: payload.rdoNumber },
      evidence: payload.evidence,
    };
  }
  if (!nc) throw new NcFlowError("Não conformidade não encontrada.");

  const keep = {
    ncStatus: nc.ncStatus,
    status: statusGrosseiro(nc.ncStatus),
    deadline: nc.deadline ?? undefined,
    reopenCount: nc.reopenCount,
    contestation: nc.contestation ?? undefined,
  };
  const sameState = (extra: Partial<EventDraft>): EventDraft => ({
    action,
    from: nc.ncStatus,
    to: nc.ncStatus,
    at: now,
    actor: payload.actor,
    role: payload.role,
    deadline: nc.deadline ?? undefined,
    rdoId: payload.rdoId,
    rdoNumber: payload.rdoNumber,
    ...extra,
  });

  // anexar uma imagem já existente não muda o estado, mas é ato: entra na trilha
  if (action === "anexar_evidencia") {
    if (!payload.evidence) throw new NcFlowError("Nenhuma imagem selecionada.");
    if (!podeAnexar(payload.role, payload.evidence.kind, nc.ncStatus)) {
      throw new NcFlowError(
        `Como ${payload.role}, você não anexa imagem de ${payload.evidence.kind} a esta peça.`,
      );
    }
    return {
      next: keep,
      event: sameState({ note: note || `Imagem de ${payload.evidence.kind} anexada do acervo da obra.` }),
      evidence: payload.evidence,
    };
  }

  // corrigir o conteúdo de uma peça já emitida não é edição: é retificação, e
  // quem a emitiu é quem a corrige
  if (action === "retificar") {
    if (payload.role !== "fiscalizacao") {
      throw new NcFlowError("Quem retifica a peça é a fiscalização, que a emitiu.");
    }
    if (!note) throw new NcFlowError("A retificação exige a razão da correção.");
    return { next: keep, event: sameState({ note }) };
  }

  const t = findTransition(action);
  if (!t) throw new NcFlowError(`Ação desconhecida: ${action}`);

  const from = nc.ncStatus;
  if (t.role !== payload.role) {
    throw new NcFlowError(`Esta ação é da ${t.role}, e você está atuando como ${payload.role}.`);
  }
  if (!t.from.includes(from)) {
    throw new NcFlowError(`Não é possível "${t.label.toLowerCase()}" com a NC em ${from}.`);
  }
  if (t.onlyOverdue && !isOverdue(nc, today)) {
    throw new NcFlowError("A reiteração só cabe depois de vencido o prazo.");
  }
  if (t.requiresNote && !note) {
    throw new NcFlowError("Esta ação exige uma justificativa por escrito.");
  }
  if (t.requiresEvidence && payload.evidence?.kind !== t.requiresEvidence) {
    throw new NcFlowError("Esta ação exige o registro fotográfico correspondente.");
  }
  // aceitar um reparo do qual não existe registro é o atalho que derruba a peça
  // na auditoria: pode acontecer (a foto veio por e-mail), mas tem de ser dito
  if (action === "aprovar" && !nc.evidenceKinds.includes("reparo") && !note) {
    throw new NcFlowError(
      "Não há registro fotográfico do reparo. Anexe a imagem do serviço executado ou justifique o aceite por escrito.",
    );
  }

  // contestação procedente encerra o apontamento em vez de devolver ao reparo
  let to: NcStatus = t.to;
  if (action === "decidir_contestacao" && payload.decisao === "procedente") to = "cancelada";

  const prazo = payload.prazoDias ?? PRAZO_PADRAO[nc.severity];
  const deadline = t.renewsDeadline && to !== "cancelada" ? addDays(today, prazo) : nc.deadline ?? undefined;

  let contestation = nc.contestation ?? undefined;
  if (action === "contestar") {
    contestation = { justificativa: note!, autor: payload.actor, criadaEm: now };
  }
  if (action === "decidir_contestacao" && contestation) {
    contestation = {
      ...contestation,
      decisao: payload.decisao ?? "improcedente",
      decididaPor: payload.actor,
      decididaEm: now,
      fundamento: note,
    };
  }

  return {
    next: {
      ncStatus: to,
      status: statusGrosseiro(to),
      deadline,
      reopenCount: action === "reprovar" ? nc.reopenCount + 1 : nc.reopenCount,
      contestation,
    },
    event: {
      action,
      from,
      to,
      at: now,
      actor: payload.actor,
      role: payload.role,
      note,
      deadline,
      rdoId: payload.rdoId,
      rdoNumber: payload.rdoNumber,
    },
    evidence: payload.evidence,
  };
}
