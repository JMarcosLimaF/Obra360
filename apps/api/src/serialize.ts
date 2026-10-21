/**
 * Linha do banco → o formato que as telas já conhecem (domain/types.ts).
 *
 * Os nomes do cliente foram mantidos mesmo onde soam estranhos (`imageDataUrl`
 * agora carrega a URL do arquivo na API, não um data URL): trocar o nome
 * espalharia mudança por dezenas de telas sem ganho para quem usa.
 */
import type {
  AiAnalysis, Capture, Contract, Contractor, Floorplan, FloorplanPin, Issue, IssueSeverity, Level,
  MpPoint, NcEvent, NcEvidence, Project, Rdo, RdoPhoto, RdoStop,
} from "./domain/types.ts";
import { PRAZO_PADRAO } from "./domain/nc-flow.ts";
import type { Storage } from "./storage.ts";

// linhas do pg chegam sem tipo; a forma é garantida pelos SELECTs deste módulo
export type Row = Record<string, any>;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const day = (v: unknown): string => iso(v).slice(0, 10);
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export const point3 = (x: unknown, y: unknown, z: unknown): MpPoint | undefined =>
  x === null || x === undefined ? undefined : { x: Number(x), y: Number(y), z: Number(z) };

/** Colunas extras para ler um geometry(PointZ) sem depender do formato binário. */
export const xyz = (col: string, alias: string) =>
  `ST_X(${col}) as ${alias}_x, ST_Y(${col}) as ${alias}_y, ST_Z(${col}) as ${alias}_z`;

export function contractor(r: Row): Contractor {
  return {
    id: r.id,
    razaoSocial: r.razao_social,
    cnpj: r.cnpj,
    responsavelTecnico: r.responsavel_tecnico ?? "",
    crea: r.crea ?? "",
    email: r.email ?? "",
    preposto: r.preposto ?? "",
  };
}

export function prazosOf(raw: unknown): Record<IssueSeverity, number> {
  const p = (raw ?? {}) as Partial<Record<IssueSeverity, number>>;
  return {
    critica: Number(p.critica ?? PRAZO_PADRAO.critica),
    alta: Number(p.alta ?? PRAZO_PADRAO.alta),
    media: Number(p.media ?? PRAZO_PADRAO.media),
    baixa: Number(p.baixa ?? PRAZO_PADRAO.baixa),
  };
}

export function contract(r: Row): Contract {
  return {
    numero: r.numero,
    processo: r.processo ?? "",
    orgaoContratante: r.orgao_contratante ?? "",
    vigenciaInicio: r.vigencia_inicio ?? "",
    vigenciaFim: r.vigencia_fim ?? "",
    valor: Number(r.valor ?? 0),
    fiscalDesignado: r.fiscal_designado ?? "",
    gestorDesignado: r.gestor_designado ?? "",
    portariaDesignacao: r.portaria_designacao ?? "",
    prazos: prazosOf(r.prazos),
  };
}

/** `c` é a linha do contrato (left join), quando houver. */
export function project(r: Row, c: Row | null | undefined, storage: Storage): Project {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    client: r.client_name ?? "",
    address: r.address ?? "",
    progressPct: Number(r.progress_pct ?? 0),
    plannedEnd: r.ends_at ?? "",
    matterportId: opt(r.matterport_id),
    coverUrl: r.cover_key ? storage.url(r.cover_key) : undefined,
    contractorId: opt(r.contractor_id),
    contract: c && c.numero ? contract(c) : undefined,
  };
}

export const level = (r: Row): Level => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  order: Number(r.sort_order ?? 0),
});

export const capture = (r: Row): Capture => ({
  id: r.id,
  levelId: r.level_id,
  date: day(r.captured_at),
  author: r.author_name ?? "",
  stage: opt(r.stage),
  status: r.status,
  progressPct: Number(r.progress_pct ?? 0),
});

export function evidence(r: Row, storage: Storage): NcEvidence {
  return {
    id: r.id,
    kind: r.kind,
    imageDataUrl: storage.url(r.image_key),
    pose: opt(r.pose),
    author: r.author_name,
    role: r.author_role,
    note: r.note ?? "",
    createdAt: iso(r.taken_at ?? r.created_at),
  };
}

export function event(r: Row): NcEvent {
  return {
    id: r.id,
    action: r.event_type,
    from: opt(r.nc_from),
    to: r.nc_to,
    at: iso(r.created_at),
    actor: r.actor_name,
    role: r.actor_role,
    note: opt(r.body),
    deadline: opt(r.deadline),
    rdoId: opt(r.rdo_id),
    rdoNumber: opt(r.rdo_number),
  };
}

export function issue(r: Row, events: NcEvent[], evidences: NcEvidence[]): Issue {
  return {
    id: r.id,
    projectId: r.project_id,
    local: r.local ?? "",
    mp: point3(r.mp_x, r.mp_y, r.mp_z),
    mpPolygon: opt(r.mp_polygon),
    areaM2: r.area_m2 === null ? undefined : Number(r.area_m2),
    title: r.title,
    description: r.description ?? "",
    discipline: r.discipline ?? "",
    severity: r.severity,
    status: r.status,
    assignee: r.assignee_name ?? "",
    dueDate: r.due_date ?? r.deadline ?? "",
    createdAt: day(r.created_at),
    createdBy: r.created_by_name ?? "",
    levelId: opt(r.level_id),
    origin: r.origin,
    floorplanId: opt(r.floorplan_id),
    pinId: opt(r.pin_id),
    rdoId: opt(r.rdo_id),
    pose: opt(r.pose),
    code: opt(r.code),
    ncStatus: r.nc_status,
    norma: opt(r.norma),
    deadline: opt(r.deadline),
    evidences,
    events,
    reopenCount: Number(r.reopen_count ?? 0),
    contestation: opt(r.contestation),
  };
}

export function rdoPhoto(r: Row, storage: Storage): RdoPhoto {
  return {
    id: r.id,
    imageDataUrl: storage.url(r.image_key),
    caption: r.caption ?? "",
    kind: r.kind,
    pose: opt(r.pose),
    createdAt: iso(r.created_at),
  };
}

export function rdoStop(r: Row, photos: RdoPhoto[]): RdoStop {
  return {
    id: r.id,
    label: r.label,
    levelId: opt(r.level_id),
    // a capa da frente é a primeira foto
    imageDataUrl: photos[0]?.imageDataUrl ?? "",
    photos,
    pose: opt(r.pose),
    observation: r.observation ?? "",
    aiStatus: r.ai_status,
    aiSimulated: opt(r.ai_simulated),
    issueIds: r.issue_ids ?? [],
    createdAt: iso(r.created_at),
  };
}

export function rdo(r: Row, stops: RdoStop[]): Rdo {
  return {
    id: r.id,
    projectId: r.project_id,
    number: Number(r.number),
    date: r.date,
    responsible: r.responsible,
    weather: r.weather,
    workable: r.workable,
    crew: r.crew ?? [],
    equipment: r.equipment ?? [],
    servicesExecuted: r.services_executed ?? "",
    occurrences: r.occurrences ?? "",
    nonConformities: r.non_conformities ?? "",
    notes: r.notes ?? "",
    analysisIds: r.analysis_ids ?? [],
    stops,
    issueIds: r.issue_ids ?? [],
    aiDrafted: Boolean(r.ai_drafted),
    aiSimulated: Boolean(r.ai_simulated),
    status: r.status,
    createdAt: iso(r.created_at),
    closedAt: r.closed_at ? iso(r.closed_at) : undefined,
  };
}

export const pin = (r: Row): FloorplanPin => ({
  id: r.id,
  x: Number(r.pos_x),
  y: Number(r.pos_y),
  label: r.label,
  note: r.note ?? "",
  issueId: opt(r.issue_id),
  pose: opt(r.pose),
  createdAt: iso(r.created_at),
});

export function floorplan(r: Row, pins: FloorplanPin[], storage: Storage): Floorplan {
  return {
    id: r.id,
    projectId: r.project_id,
    levelId: opt(r.level_id),
    name: r.name,
    imageSrc: storage.url(r.image_key),
    analysis: opt(r.analysis),
    analysisAt: r.analysis_at ? iso(r.analysis_at) : undefined,
    analysisSimulated: opt(r.analysis_simulated),
    pins,
    createdAt: iso(r.created_at),
  };
}

export function analysis(r: Row, storage: Storage): AiAnalysis {
  return {
    id: r.id,
    projectId: r.project_id,
    createdAt: iso(r.created_at),
    question: r.question ?? "",
    result: r.result,
    imageDataUrl: r.image_key ? storage.url(r.image_key) : "",
    cameraPos: point3(r.cam_x, r.cam_y, r.cam_z),
    simulated: Boolean(r.simulated),
  };
}
