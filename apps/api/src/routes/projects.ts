/**
 * A obra em si: o cadastro (obra, pavimentos, contratada e contrato) e a foto
 * de capa, que a lista de obras mostra antes da miniatura do Matterport.
 */
import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/session.ts";
import { ok, userClient } from "../db/supabase.ts";
import type { IssueSeverity } from "../domain/types.ts";
import { cnpjValido, formatCnpj } from "../lib/cnpj.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { projectAccess, requireWriter, uuidRe } from "../services/access.ts";
import { createProject, type NewContractInput, type NewContractorInput, type NewProjectInput } from "../services/projects.ts";

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: authenticate(app) };

  app.post("/api/projects", guard, async (req, reply) => {
    const input = parseNewProject(req.body);
    const created = await createProject(app.ctx, userClient(app.ctx.cfg, req.accessToken), req, input);
    return reply.code(201).send(created);
  });

  // a foto chega como as evidências: data URL nova ou URL de arquivo já guardado
  app.put<{ Params: { projectId: string } }>("/api/projects/:projectId/cover", guard, async (req) => {
    const { ctx } = app;
    const image = (req.body as { image?: unknown } | undefined)?.image;
    if (typeof image !== "string" || !image) throw badRequest("Envie a foto da obra.");
    if (!uuidRe.test(req.params.projectId)) throw notFound("Obra");

    const sb = userClient(ctx.cfg, req.accessToken);
    const access = await projectAccess(sb, req, req.params.projectId);
    requireWriter(access);
    const key = await ctx.storage.keyFromRef(access.project.org_id, image);
    ok(await sb.rpc("project_set_cover", { p_project: access.project.id, p_cover_key: key }));
    return { coverUrl: ctx.storage.url(key) };
  });
}

const SEVERITIES: IssueSeverity[] = ["critica", "alta", "media", "baixa"];
const PRAZO_PADRAO: Record<IssueSeverity, number> = { critica: 2, alta: 7, media: 15, baixa: 30 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseNewProject(body: unknown): NewProjectInput {
  const b = (body ?? {}) as Record<string, unknown>;

  const name = str(b.name).replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 120) throw badRequest("O nome da obra precisa ter de 3 a 120 caracteres.");
  // o nome vira o endereço da página da obra
  if (/[/\\?#%]/.test(name)) throw badRequest("O nome da obra não pode ter / \\ ? # ou %.");

  const client = str(b.client);
  if (!client) throw badRequest("Informe o órgão contratante ou cliente.");

  const startsAt = optionalDate(b.startsAt, "início");
  const endsAt = optionalDate(b.endsAt, "entrega prevista");
  if (!endsAt) throw badRequest("Informe a data de entrega prevista.");
  if (startsAt && endsAt < startsAt) throw badRequest("A entrega prevista não pode ser antes do início.");

  const progressPct = typeof b.progressPct === "number" && Number.isFinite(b.progressPct) ? b.progressPct : 0;
  if (progressPct < 0 || progressPct > 100) throw badRequest("O avanço físico vai de 0 a 100%.");

  const matterportId = optionalStr(b.matterportId);
  if (matterportId && !/^[A-Za-z0-9]{6,30}$/.test(matterportId)) {
    throw badRequest("O identificador do modelo Matterport tem só letras e números (ex.: JKDH2SEKWcv).");
  }

  const cover = optionalStr(b.cover);

  const rawLevels = Array.isArray(b.levels) ? b.levels : [];
  const levels = rawLevels.map((l) => str(l).replace(/\s+/g, " ")).filter(Boolean);
  if (levels.length === 0) throw badRequest("Cadastre ao menos um pavimento.");
  if (levels.length > 80) throw badRequest("No máximo 80 pavimentos por obra.");
  if (levels.some((l) => l.length > 60)) throw badRequest("Nome de pavimento com mais de 60 caracteres.");
  const seen = new Set<string>();
  for (const l of levels) {
    const k = l.toLocaleLowerCase("pt-BR");
    if (seen.has(k)) throw badRequest(`O pavimento "${l}" aparece duas vezes.`);
    seen.add(k);
  }

  return {
    name,
    client,
    address: optionalStr(b.address),
    startsAt,
    endsAt,
    progressPct: Math.round(progressPct),
    matterportId,
    cover,
    levels,
    contractor: parseContractor(b.contractor),
    contract: parseContract(b.contract, startsAt, endsAt),
  };
}

function parseContractor(raw: unknown): { id: string } | NewContractorInput | null {
  if (raw === null || raw === undefined) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id === "string") {
    if (!uuidRe.test(c.id)) throw badRequest("Contratada inválida.");
    return { id: c.id };
  }
  const razaoSocial = str(c.razaoSocial);
  if (!razaoSocial) throw badRequest("Informe a razão social da contratada.");
  const digits = str(c.cnpj).replace(/\D/g, "");
  if (!cnpjValido(digits)) throw badRequest("CNPJ da contratada inválido.");
  const email = optionalStr(c.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("E-mail da contratada inválido.");
  return {
    razaoSocial,
    cnpj: formatCnpj(digits),
    responsavelTecnico: optionalStr(c.responsavelTecnico),
    crea: optionalStr(c.crea),
    email,
    preposto: optionalStr(c.preposto),
  };
}

function parseContract(raw: unknown, startsAt?: string, endsAt?: string): NewContractInput | null {
  if (raw === null || raw === undefined) return null;
  const k = raw as Record<string, unknown>;
  const numero = str(k.numero);
  if (!numero) throw badRequest("Informe o número do contrato.");
  const vigenciaInicio = optionalDate(k.vigenciaInicio, "início da vigência") ?? startsAt;
  const vigenciaFim = optionalDate(k.vigenciaFim, "fim da vigência") ?? endsAt;
  if (vigenciaInicio && vigenciaFim && vigenciaFim < vigenciaInicio) {
    throw badRequest("O fim da vigência não pode ser antes do início.");
  }
  let valor: number | undefined;
  if (k.valor !== undefined && k.valor !== null && k.valor !== "") {
    if (typeof k.valor !== "number" || !Number.isFinite(k.valor) || k.valor < 0) {
      throw badRequest("Valor do contrato inválido.");
    }
    valor = Math.round(k.valor * 100) / 100;
  }
  const p = (k.prazos ?? {}) as Record<string, unknown>;
  const prazos = { ...PRAZO_PADRAO };
  for (const s of SEVERITIES) {
    if (p[s] === undefined) continue;
    const v = p[s];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 365) {
      throw badRequest("Os prazos de reparo vão de 1 a 365 dias.");
    }
    prazos[s] = v;
  }
  return {
    numero,
    processo: optionalStr(k.processo),
    orgaoContratante: optionalStr(k.orgaoContratante),
    vigenciaInicio,
    vigenciaFim,
    valor,
    fiscalDesignado: optionalStr(k.fiscalDesignado),
    gestorDesignado: optionalStr(k.gestorDesignado),
    portariaDesignacao: optionalStr(k.portariaDesignacao),
    prazos,
  };
}

function optionalDate(v: unknown, label: string): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (!DATE_RE.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw badRequest(`Data de ${label} inválida.`);
  }
  return s;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const optionalStr = (v: unknown) => {
  const s = str(v);
  return s || undefined;
};
