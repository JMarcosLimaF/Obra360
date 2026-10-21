import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/session.ts";
import { userClient } from "../db/supabase.ts";
import type { IssueSeverity, NcAction } from "../domain/types.ts";
import { badRequest } from "../lib/errors.ts";
import { createIssue, editIssue, loadIssues, transition, type CreateIssueInput, type EditInput, type TransitionInput } from "../services/issues.ts";

const SEVERITIES = new Set(["baixa", "media", "alta", "critica"]);

export async function issueRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: authenticate(app) };

  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/issues", guard, async (req) => {
    return loadIssues(app.ctx, userClient(app.ctx.cfg, req.accessToken), { projectId: req.params.projectId });
  });

  app.post<{ Params: { projectId: string } }>("/api/projects/:projectId/issues", guard, async (req, reply) => {
    const input = parseCreate(req.body);
    const issue = await createIssue(app.ctx, userClient(app.ctx.cfg, req.accessToken), req, req.params.projectId, input);
    return reply.code(201).send(issue);
  });

  app.post<{ Params: { id: string } }>("/api/issues/:id/transition", guard, async (req) => {
    const input = parseTransition(req.body);
    return transition(app.ctx, userClient(app.ctx.cfg, req.accessToken), req, req.params.id, input);
  });

  app.patch<{ Params: { id: string } }>("/api/issues/:id", guard, async (req) => {
    const input = parseEdit(req.body);
    return editIssue(app.ctx, userClient(app.ctx.cfg, req.accessToken), req, req.params.id, input);
  });
}

function parseCreate(body: unknown): CreateIssueInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = str(b.title);
  const description = str(b.description);
  const discipline = str(b.discipline);
  const local = str(b.local);
  const assignee = str(b.assignee);
  const severity = str(b.severity) as IssueSeverity;
  if (!title || !discipline || !local || !assignee || !SEVERITIES.has(severity)) {
    throw badRequest("Título, disciplina, local, responsável e severidade são obrigatórios.");
  }
  return {
    title,
    description,
    discipline,
    severity,
    local,
    assignee,
    norma: optionalStr(b.norma),
    levelId: optionalStr(b.levelId),
    origin: optionalStr(b.origin) as CreateIssueInput["origin"],
    floorplanId: optionalStr(b.floorplanId),
    pinId: optionalStr(b.pinId),
    rdoId: optionalStr(b.rdoId),
    pose: b.pose as CreateIssueInput["pose"],
    mp: b.mp as CreateIssueInput["mp"],
    mpPolygon: b.mpPolygon as CreateIssueInput["mpPolygon"],
    areaM2: typeof b.areaM2 === "number" ? b.areaM2 : undefined,
    evidence: b.evidence as CreateIssueInput["evidence"],
  };
}

function parseTransition(body: unknown): TransitionInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const action = str(b.action) as NcAction;
  if (!action) throw badRequest("Informe a ação do trâmite.");
  return {
    action,
    note: optionalStr(b.note),
    evidence: b.evidence as TransitionInput["evidence"],
    decisao: b.decisao === "procedente" || b.decisao === "improcedente" ? b.decisao : undefined,
    prazoDias: typeof b.prazoDias === "number" ? b.prazoDias : undefined,
    rdoId: optionalStr(b.rdoId),
  };
}

function parseEdit(body: unknown): EditInput {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    title: optionalStr(b.title),
    description: optionalStr(b.description),
    discipline: optionalStr(b.discipline),
    severity: SEVERITIES.has(str(b.severity)) ? (str(b.severity) as IssueSeverity) : undefined,
    norma: b.norma === null ? null : optionalStr(b.norma),
    assignee: optionalStr(b.assignee),
    local: optionalStr(b.local),
    razao: optionalStr(b.razao),
  };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const optionalStr = (v: unknown) => {
  const s = str(v);
  return s || undefined;
};
