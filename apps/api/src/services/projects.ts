/**
 * Cadastro de obra: a obra, os pavimentos, a contratada (nova ou já
 * cadastrada) e o contrato, numa ida só.
 *
 * Tudo vai com o JWT do usuário, então quem decide é o RLS: obra, contrato e
 * contratada são escritos por owner/gestor (policies projects_write,
 * contracts_write e contractors_write). O PostgREST não segura transação entre
 * chamadas; se um passo falha depois da obra gravada, o cadastro é desfeito
 * (a obra leva pavimentos e contrato junto, pelo on delete cascade).
 */
import type { FastifyRequest } from "fastify";
import { PROJECT_ADMINS } from "../auth/roles.ts";
import type { Ctx } from "../context.ts";
import type { Sb } from "../db/supabase.ts";
import { ok } from "../db/supabase.ts";
import type { Contractor, IssueSeverity, Level, Project } from "../domain/types.ts";
import { badRequest, conflict, forbidden } from "../lib/errors.ts";
import * as S from "../serialize.ts";
import type { Row } from "../serialize.ts";

export interface NewContractorInput {
  razaoSocial: string;
  cnpj: string;
  responsavelTecnico?: string;
  crea?: string;
  email?: string;
  preposto?: string;
}

export interface NewContractInput {
  numero: string;
  processo?: string;
  orgaoContratante?: string;
  vigenciaInicio?: string;
  vigenciaFim?: string;
  valor?: number;
  fiscalDesignado?: string;
  gestorDesignado?: string;
  portariaDesignacao?: string;
  prazos: Record<IssueSeverity, number>;
}

export interface NewProjectInput {
  name: string;
  client: string;
  address?: string;
  startsAt?: string;
  endsAt: string;
  progressPct: number;
  matterportId?: string;
  /** data URL da foto de capa */
  cover?: string;
  levels: string[];
  contractor: { id: string } | NewContractorInput | null;
  contract: NewContractInput | null;
}

export interface CreatedProject {
  project: Project;
  levels: Level[];
  contractor?: Contractor;
  /** o que não impediu o cadastro, mas a tela precisa contar (ex.: a capa não gravou) */
  warnings: string[];
}

export async function createProject(ctx: Ctx, sb: Sb, req: FastifyRequest, input: NewProjectInput): Promise<CreatedProject> {
  const membership = req.auth.memberships.find((m) => PROJECT_ADMINS.includes(m.role));
  if (!membership) {
    throw forbidden("O cadastro de obras é feito pelo gestor do contrato.");
  }
  const orgId = membership.orgId;

  // o nome da obra é o endereço da página: não pode repetir na organização
  const existing = (ok(await sb.from("projects").select("name").eq("org_id", orgId)) ?? []) as Row[];
  const lower = input.name.toLocaleLowerCase("pt-BR");
  if (existing.some((p) => String(p.name).toLocaleLowerCase("pt-BR") === lower)) {
    throw conflict("Já existe uma obra com esse nome. Escolha outro para não confundir os endereços.");
  }

  let contractorId: string | null = null;
  let newContractor: Row | null = null;
  if (input.contractor && "id" in input.contractor) {
    const found = ok(
      await sb.from("contractors").select("id").eq("id", input.contractor.id).eq("org_id", orgId).maybeSingle(),
    );
    if (!found) throw badRequest("Contratada não encontrada nesta organização.");
    contractorId = found.id as string;
  }

  const coverKey = input.cover ? await ctx.storage.keyFromRef(orgId, input.cover) : null;

  if (input.contractor && !("id" in input.contractor)) {
    const c = input.contractor;
    newContractor = ok(
      await sb
        .from("contractors")
        .insert({
          org_id: orgId,
          razao_social: c.razaoSocial,
          cnpj: c.cnpj,
          responsavel_tecnico: c.responsavelTecnico ?? null,
          crea: c.crea ?? null,
          email: c.email ?? null,
          preposto: c.preposto ?? null,
        })
        .select("*")
        .single(),
    ) as Row;
    contractorId = newContractor.id as string;
  }

  let projectRow: Row | null = null;
  try {
    projectRow = ok(
      await sb
        .from("projects")
        .insert({
          org_id: orgId,
          name: input.name,
          client_name: input.client,
          address: input.address ?? null,
          starts_at: input.startsAt ?? null,
          ends_at: input.endsAt,
          status: "ativa",
          matterport_id: input.matterportId ?? null,
          progress_pct: input.progressPct,
          contractor_id: contractorId,
        })
        .select("*")
        .single(),
    ) as Row;
    const projectId = projectRow.id as string;

    const levelRows = (ok(
      await sb
        .from("levels")
        .insert(input.levels.map((name, i) => ({ project_id: projectId, name, sort_order: i })))
        .select("*"),
    ) ?? []) as Row[];

    let contractRow: Row | null = null;
    if (input.contract) {
      const k = input.contract;
      contractRow = ok(
        await sb
          .from("contracts")
          .insert({
            project_id: projectId,
            numero: k.numero,
            processo: k.processo ?? null,
            orgao_contratante: k.orgaoContratante ?? input.client,
            vigencia_inicio: k.vigenciaInicio ?? null,
            vigencia_fim: k.vigenciaFim ?? null,
            valor: k.valor ?? null,
            fiscal_designado: k.fiscalDesignado ?? null,
            gestor_designado: k.gestorDesignado ?? null,
            portaria_designacao: k.portariaDesignacao ?? null,
            prazos: k.prazos,
          })
          .select("*")
          .single(),
      ) as Row;
    }

    // a capa vai por último e não derruba o cadastro: a coluna cover_key vem da
    // migração 0004, que pode ainda não estar aplicada no banco
    const warnings: string[] = [];
    if (coverKey) {
      const res = await sb.from("projects").update({ cover_key: coverKey }).eq("id", projectId).select("*").single();
      if (res.error) {
        console.error("[supabase] capa da obra:", res.error.message);
        warnings.push(
          /cover_key/.test(res.error.message)
            ? "A obra foi cadastrada, mas a foto de capa não foi salva: falta aplicar a migração 0004_project_cover.sql no banco."
            : "A obra foi cadastrada, mas a foto de capa não foi salva. Tente enviá-la de novo pela lista de obras.",
        );
      } else {
        projectRow = res.data as Row;
      }
    }

    return {
      warnings,
      project: S.project(projectRow, contractRow, ctx.storage),
      levels: levelRows.sort((a, b) => Number(a.sort_order) - Number(b.sort_order)).map(S.level),
      contractor: newContractor ? S.contractor(newContractor) : undefined,
    };
  } catch (err) {
    // desfaz o que ficou pela metade; o erro original é o que a tela mostra
    if (projectRow) await sb.from("projects").delete().eq("id", projectRow.id);
    if (newContractor) await sb.from("contractors").delete().eq("id", newContractor.id);
    throw err;
  }
}
