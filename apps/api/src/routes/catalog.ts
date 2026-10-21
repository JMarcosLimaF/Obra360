/**
 * O que a tela precisa para abrir: obras, pavimentos, visitas, contratadas
 * e as não conformidades que o papel do usuário pode ver.
 */
import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/session.ts";
import { ok, userClient } from "../db/supabase.ts";
import type { Issue } from "../domain/types.ts";
import { loadIssues } from "../services/issues.ts";
import * as S from "../serialize.ts";
import type { Row } from "../serialize.ts";

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/bootstrap", { preHandler: authenticate(app) }, async (req) => {
    const { ctx } = app;
    const sb = userClient(ctx.cfg, req.accessToken);
    const projects = (ok(await sb.from("projects").select("*").order("name")) ?? []) as Row[];
    const contracts = (ok(await sb.from("contracts").select("*")) ?? []) as Row[];
    const byProject = new Map(contracts.map((c) => [c.project_id, c]));
    const contractors = (ok(await sb.from("contractors").select("*").order("razao_social")) ?? []) as Row[];
    const levels = (ok(await sb.from("levels").select("*").order("sort_order").order("name")) ?? []) as Row[];
    const captures = (ok(await sb.from("captures_api").select("*").order("captured_at")) ?? []) as Row[];
    const issues: Issue[] = [];
    for (const p of projects) {
      issues.push(...(await loadIssues(ctx, sb, { projectId: p.id })));
    }
    const org = req.auth.memberships[0];
    return {
      orgName: org?.orgName ?? "",
      projects: projects.map((p) => S.project(p, byProject.get(p.id), ctx.storage)),
      contractors: contractors.map(S.contractor),
      levels: levels.map(S.level),
      captures: captures.map(S.capture),
      issues,
    };
  });
}
