/**
 * Quem pode o quê numa obra.
 *
 * O RLS do Supabase é a última trava; aqui ficam as checagens que dão mensagem
 * útil antes de bater nela ("só a fiscalização…" em vez de "row-level security").
 */
import type { FastifyRequest } from "fastify";
import { WRITERS, type MemberRole } from "../auth/roles.ts";
import type { Membership } from "../context.ts";
import type { Sb } from "../db/supabase.ts";
import { ok } from "../db/supabase.ts";
import type { NcRole } from "../domain/types.ts";
import { NC_ROLE_LABEL } from "../domain/types.ts";
import { forbidden, notFound } from "../lib/errors.ts";
import type { Row } from "../serialize.ts";

export interface ProjectAccess {
  project: Row;
  membership: Membership;
  role: MemberRole;
  ncRole: NcRole | null;
}

/** Abre a obra pelo RLS: se a policy esconde, para o usuário ela não existe. */
export async function projectAccess(sb: Sb, req: FastifyRequest, projectId: string): Promise<ProjectAccess> {
  const project = ok(await sb.from("projects").select("*").eq("id", projectId).maybeSingle());
  if (!project) throw notFound("Obra");
  const membership = req.auth.memberships.find((m) => m.orgId === project.org_id);
  if (!membership) throw notFound("Obra");
  return { project, membership, role: membership.role, ncRole: membership.ncRole };
}

/** Escrever no acervo (RDO, plantas, análises) é do lado da fiscalização. */
export function requireWriter(a: ProjectAccess): void {
  if (!WRITERS.includes(a.role)) {
    throw forbidden("O acervo da obra é registrado pela fiscalização; seu papel tem acesso de leitura.");
  }
}

export function requireNcRole(a: ProjectAccess, ...roles: NcRole[]): NcRole {
  if (!a.ncRole || !roles.includes(a.ncRole)) {
    const quem = roles.map((r) => NC_ROLE_LABEL[r].toLowerCase()).join(" ou ");
    throw forbidden(`Esta operação é da ${quem}.`);
  }
  return a.ncRole;
}

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
