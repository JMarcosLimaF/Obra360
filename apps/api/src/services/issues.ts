/**
 * Persistência do trâmite da não conformidade.
 *
 * Aqui não se decide nada: quem decide é `apply` (domain/nc-flow.ts). Este
 * módulo carrega o estado, chama `apply`, e grava estado + evento + evidência
 * numa função do Supabase. Essa função é o único lugar que marca a transação
 * com `obra360.nc_apply`, sem a qual o gatilho do banco recusa mexer nos
 * campos do trâmite. A gravação só acontece se o estado ainda for o que foi
 * lido — dois cliques simultâneos não aplicam dois atos sobre o mesmo estado.
 */
import type { FastifyRequest } from "fastify";
import type { Ctx } from "../context.ts";
import type { Sb } from "../db/supabase.ts";
import { ok } from "../db/supabase.ts";
import {
  apply,
  NcFlowError,
  PRAZO_PADRAO,
  statusGrosseiro,
  addDays,
  type ApplyResult,
  type EvidenceInput,
  type NcState,
} from "../domain/nc-flow.ts";
import type { Issue, IssueOrigin, IssueSeverity, MpPoint, NcAction, NcEvidenceKind, TourPose } from "../domain/types.ts";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.ts";
import * as S from "../serialize.ts";
import { prazosOf, type Row } from "../serialize.ts";
import { projectAccess, requireNcRole, type ProjectAccess } from "./access.ts";

/** Carrega NCs com histórico e evidências — o RLS decide quais o usuário enxerga. */
export async function loadIssues(ctx: Ctx, sb: Sb, filter: { projectId?: string; id?: string }): Promise<Issue[]> {
  let q = sb.from("issues_api").select("*");
  q = filter.id ? q.eq("id", filter.id) : q.eq("project_id", filter.projectId ?? "");
  const rows = (ok(await q.order("created_at").order("code")) ?? []) as Row[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id as string);
  const events = (ok(await sb.from("issue_events").select("*").in("issue_id", ids).order("created_at")) ?? []) as Row[];
  const evidences = (ok(await sb.from("issue_evidences").select("*").in("issue_id", ids).order("created_at")) ?? []) as Row[];
  return rows.map((r) =>
    S.issue(
      r,
      events.filter((e) => e.issue_id === r.id).map(S.event),
      evidences.filter((e) => e.issue_id === r.id).map((e) => S.evidence(e, ctx.storage)),
    ),
  );
}

export async function loadIssue(ctx: Ctx, sb: Sb, id: string): Promise<Issue> {
  const [nc] = await loadIssues(ctx, sb, { id });
  if (!nc) throw notFound("Não conformidade");
  return nc;
}

/** Prazo do contrato para a severidade; sem contrato, o padrão do trâmite. */
async function prazoDoContrato(sb: Sb, projectId: string, severity: IssueSeverity): Promise<number> {
  const c = ok(await sb.from("contracts").select("prazos").eq("project_id", projectId).maybeSingle()) as Row | null;
  return c ? prazosOf(c.prazos)[severity] : PRAZO_PADRAO[severity];
}

async function rdoNumber(sb: Sb, projectId: string, rdoId?: string): Promise<number | undefined> {
  if (!rdoId) return undefined;
  const r = ok(await sb.from("rdos").select("number").eq("id", rdoId).eq("project_id", projectId).maybeSingle()) as Row | null;
  if (!r) throw badRequest("RDO informado não pertence a esta obra.");
  return Number(r.number);
}

function eventBody(r: ApplyResult) {
  const e = r.event;
  return {
    action: e.action,
    note: e.note ?? null,
    from_coarse: e.from ? statusGrosseiro(e.from) : null,
    coarse: statusGrosseiro(e.to),
    from: e.from ?? null,
    to: e.to,
    actor: e.actor,
    role: e.role,
    deadline: e.deadline ?? null,
    rdo_id: e.rdoId ?? null,
    rdo_number: e.rdoNumber ?? null,
    at: e.at,
  };
}

async function evidenceBody(ctx: Ctx, orgId: string, r: ApplyResult, ev: EvidenceInput) {
  return {
    kind: ev.kind,
    image_key: await ctx.storage.keyFromRef(orgId, ev.image),
    pose: ev.pose ?? null,
    note: ev.note ?? "",
    taken_at: ev.takenAt ?? null,
    author_name: r.event.actor,
    author_role: r.event.role,
  };
}

/** Grava o resultado de `apply` se o estado ainda for o que lemos. */
async function persist(
  ctx: Ctx,
  sb: Sb,
  orgId: string,
  issueId: string,
  userId: string,
  expected: string,
  result: ApplyResult,
  extra: { assigneeId?: string | null } = {},
): Promise<void> {
  ok(await sb.rpc("nc_save_tramite", {
    p: {
      issue_id: issueId,
      author_id: userId,
      expected,
      nc_status: result.next.ncStatus,
      deadline: result.next.deadline ?? null,
      reopen_count: result.next.reopenCount,
      contestation: result.next.contestation ?? null,
      assignee_id: extra.assigneeId ?? null,
      event: eventBody(result),
      evidence: result.evidence ? await evidenceBody(ctx, orgId, result, result.evidence) : null,
    },
  }));
}

export interface CreateIssueInput {
  title: string;
  description: string;
  discipline: string;
  severity: IssueSeverity;
  local: string;
  assignee: string;
  norma?: string;
  levelId?: string;
  origin?: IssueOrigin;
  floorplanId?: string;
  pinId?: string;
  rdoId?: string;
  pose?: TourPose;
  mp?: MpPoint;
  mpPolygon?: MpPoint[];
  areaM2?: number;
  evidence?: EvidenceInput;
}

/** Abertura: a peça nasce em rascunho, pelo mesmo `apply` dos demais atos. */
export async function createIssue(
  ctx: Ctx,
  sb: Sb,
  req: FastifyRequest,
  projectId: string,
  input: CreateIssueInput,
): Promise<Issue> {
  const access = await projectAccess(sb, req, projectId);
  const role = requireNcRole(access, "fiscalizacao");
  const today = ctx.today();
  const now = new Date().toISOString();

  if (input.evidence && input.evidence.kind !== "abertura") {
    throw badRequest("A imagem da abertura deve ser do tipo abertura.");
  }
  const result = apply(null, "abertura", {
    actor: req.auth.user.name,
    role,
    today,
    now,
    evidence: input.evidence,
    rdoId: input.rdoId,
    rdoNumber: await rdoNumber(sb, projectId, input.rdoId),
  });
  const dueDate = addDays(today, await prazoDoContrato(sb, projectId, input.severity));

  const id = ok(await sb.rpc("nc_insert_issue", {
    p: {
      org_id: access.project.org_id,
      project_id: projectId,
      title: input.title,
      description: input.description,
      discipline: input.discipline,
      severity: input.severity,
      nc_status: result.next.ncStatus,
      created_by: req.auth.user.id,
      created_by_name: req.auth.user.name,
      due_date: dueDate,
      created_at: now,
      local: input.local,
      norma: input.norma ?? null,
      level_id: input.levelId ?? null,
      origin: input.origin ?? "manual",
      floorplan_id: input.floorplanId ?? null,
      pin_id: input.pinId ?? null,
      rdo_id: input.rdoId ?? null,
      pose: input.pose ?? null,
      mp: input.mp ?? null,
      mp_polygon: input.mpPolygon ?? null,
      area_m2: input.areaM2 ?? null,
      assignee_name: input.assignee,
      event: eventBody(result),
      evidence: result.evidence ? await evidenceBody(ctx, access.project.org_id, result, result.evidence) : null,
    },
  }));
  return loadIssue(ctx, sb, String(id));
}

async function stateOf(sb: Sb, nc: Row): Promise<NcState> {
  const rows = (ok(await sb.from("issue_evidences").select("kind").eq("issue_id", nc.id)) ?? []) as { kind: NcEvidenceKind }[];
  return {
    ncStatus: nc.nc_status,
    severity: nc.severity,
    deadline: nc.deadline,
    reopenCount: Number(nc.reopen_count),
    evidenceKinds: [...new Set(rows.map((r) => r.kind))],
    contestation: nc.contestation,
  };
}

async function accessOfIssue(sb: Sb, req: FastifyRequest, issueId: string): Promise<{ nc: Row; access: ProjectAccess }> {
  const nc = ok(await sb.from("issues").select("*").eq("id", issueId).maybeSingle()) as Row | null;
  if (!nc) throw notFound("Não conformidade");
  const access = await projectAccess(sb, req, nc.project_id);
  return { nc, access };
}

export interface TransitionInput {
  action: NcAction;
  note?: string;
  evidence?: EvidenceInput;
  decisao?: "procedente" | "improcedente";
  prazoDias?: number;
  rdoId?: string;
}

/** Um ato do trâmite. Transição inválida sai daqui como NcFlowError (422). */
export async function transition(
  ctx: Ctx,
  sb: Sb,
  req: FastifyRequest,
  issueId: string,
  input: TransitionInput,
): Promise<Issue> {
  if (input.action === "abertura") throw new NcFlowError("A abertura acontece ao criar a peça.");
  if (input.action === "retificar") throw new NcFlowError("Retificação é feita pela edição da peça, com a razão.");
  const { nc, access } = await accessOfIssue(sb, req, issueId);
  if (!access.ncRole) throw forbidden("Seu papel é somente leitura no trâmite.");

  let prazoDias = await prazoDoContrato(sb, nc.project_id, nc.severity);
  if (input.action === "prorrogar" && input.prazoDias !== undefined) prazoDias = input.prazoDias;

  const result = apply(await stateOf(sb, nc), input.action, {
    actor: req.auth.user.name,
    role: access.ncRole,
    note: input.note,
    evidence: input.evidence,
    decisao: input.decisao,
    prazoDias,
    rdoId: input.rdoId,
    rdoNumber: await rdoNumber(sb, nc.project_id, input.rdoId),
    today: ctx.today(),
    now: new Date().toISOString(),
  });

  let assigneeId: string | null = null;
  if (input.action === "notificar") {
    const project = ok(await sb.from("projects").select("contractor_id").eq("id", nc.project_id).maybeSingle()) as Row | null;
    const contractor = project?.contractor_id
      ? ok(await sb.from("contractors").select("preposto_user_id").eq("id", project.contractor_id).maybeSingle()) as Row | null
      : null;
    if (!contractor?.preposto_user_id) {
      throw new NcFlowError("A obra não tem preposto da contratada cadastrado — a notificação ficaria sem destinatário.");
    }
    assigneeId = contractor.preposto_user_id;
  }

  await persist(ctx, sb, access.project.org_id, issueId, req.auth.user.id, nc.nc_status, result, { assigneeId });
  return loadIssue(ctx, sb, issueId);
}

export interface EditInput {
  title?: string;
  description?: string;
  discipline?: string;
  severity?: IssueSeverity;
  norma?: string | null;
  assignee?: string;
  local?: string;
  razao?: string;
}

/**
 * Rascunho se edita à vontade. Peça emitida se retifica: exige a razão e entra
 * no histórico pelo `apply`. A severidade trava depois da notificação, porque é
 * ela que definiu o prazo já concedido — para mexer no prazo existe prorrogar.
 */
export async function editIssue(
  ctx: Ctx,
  sb: Sb,
  req: FastifyRequest,
  issueId: string,
  input: EditInput,
): Promise<Issue> {
  const { nc, access } = await accessOfIssue(sb, req, issueId);
  const role = requireNcRole(access, "fiscalizacao");
  const emitida = nc.nc_status !== "rascunho";

  if (emitida && input.severity && input.severity !== nc.severity) {
    throw conflict("A severidade define o prazo já notificado; para mudar o prazo, use prorrogar.");
  }

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.discipline !== undefined) patch.discipline = input.discipline;
  if (!emitida && input.severity && input.severity !== nc.severity) {
    patch.severity = input.severity;
    patch.due_date = addDays(ctx.today(), await prazoDoContrato(sb, nc.project_id, input.severity));
  }
  if (input.norma !== undefined) patch.norma = input.norma?.trim() || null;
  if (input.assignee !== undefined) patch.assignee_name = input.assignee;
  if (input.local !== undefined) patch.local = input.local;
  if (Object.keys(patch).length > 0) {
    ok(await sb.from("issues").update(patch).eq("id", issueId));
  }

  if (emitida) {
    const result = apply(await stateOf(sb, nc), "retificar", {
      actor: req.auth.user.name,
      role,
      note: input.razao,
      today: ctx.today(),
      now: new Date().toISOString(),
    });
    await persist(ctx, sb, access.project.org_id, issueId, req.auth.user.id, nc.nc_status, result);
  }
  return loadIssue(ctx, sb, issueId);
}
