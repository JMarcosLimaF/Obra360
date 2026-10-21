/**
 * Formato do que a API devolve — é o mesmo de `apps/web/src/types.ts`, de
 * propósito: as telas já existem e foram desenhadas sobre esses tipos. Se um
 * campo mudar aqui, muda lá também.
 */

export type IssueStatus = "aberto" | "em_execucao" | "aguardando_verificacao" | "resolvido";
export type IssueSeverity = "baixa" | "media" | "alta" | "critica";
export type IssueOrigin = "viewer" | "planta" | "rdo" | "manual";

export type NcStatus =
  | "rascunho"
  | "notificada"
  | "ciente"
  | "em_reparo"
  | "reparo_submetido"
  | "contestada"
  | "sanada"
  | "cancelada";

export type NcRole = "fiscalizacao" | "construtora" | "gestor";

export type NcAction =
  | "abertura"
  | "notificar"
  | "dar_ciencia"
  | "iniciar_reparo"
  | "submeter_reparo"
  | "aprovar"
  | "reprovar"
  | "contestar"
  | "decidir_contestacao"
  | "prorrogar"
  | "reiterar"
  | "cancelar"
  | "anexar_evidencia"
  | "retificar";

export type NcEvidenceKind = "abertura" | "reparo" | "verificacao";

export const SEVERITIES: IssueSeverity[] = ["baixa", "media", "alta", "critica"];
export const NC_STATUSES: NcStatus[] = [
  "rascunho", "notificada", "ciente", "em_reparo", "reparo_submetido", "contestada", "sanada", "cancelada",
];
export const NC_ROLES: NcRole[] = ["fiscalizacao", "construtora", "gestor"];
export const NC_ROLE_LABEL: Record<NcRole, string> = {
  fiscalizacao: "Fiscalização",
  construtora: "Construtora",
  gestor: "Gestor do contrato",
};

export interface TourPose {
  sweep: string;
  rotation: { x: number; y: number };
}

export interface MpPoint {
  x: number;
  y: number;
  z: number;
}

export interface Contractor {
  id: string;
  razaoSocial: string;
  cnpj: string;
  responsavelTecnico: string;
  crea: string;
  email: string;
  preposto: string;
}

export interface Contract {
  numero: string;
  processo: string;
  orgaoContratante: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  valor: number;
  fiscalDesignado: string;
  gestorDesignado: string;
  portariaDesignacao: string;
  prazos: Record<IssueSeverity, number>;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  client: string;
  address: string;
  progressPct: number;
  plannedEnd: string;
  matterportId?: string;
  /** foto de capa enviada para a obra (URL de arquivo da API) */
  coverUrl?: string;
  contractorId?: string;
  contract?: Contract;
}

export interface Level {
  id: string;
  projectId: string;
  name: string;
  order: number;
}

export interface Capture {
  id: string;
  levelId: string;
  date: string;
  author: string;
  stage?: string;
  status?: string;
  progressPct?: number;
}

export interface NcEvidence {
  id: string;
  kind: NcEvidenceKind;
  imageDataUrl: string;
  pose?: TourPose;
  author: string;
  role: NcRole;
  note: string;
  createdAt: string;
}

export interface NcEvent {
  id: string;
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

export interface NcContestation {
  justificativa: string;
  autor: string;
  criadaEm: string;
  decisao?: "procedente" | "improcedente";
  decididaPor?: string;
  decididaEm?: string;
  fundamento?: string;
}

export interface Issue {
  id: string;
  projectId: string;
  local: string;
  mp?: MpPoint;
  mpPolygon?: MpPoint[];
  areaM2?: number;
  title: string;
  description: string;
  discipline: string;
  severity: IssueSeverity;
  status: IssueStatus;
  assignee: string;
  dueDate: string;
  createdAt: string;
  createdBy: string;
  levelId?: string;
  origin?: IssueOrigin;
  floorplanId?: string;
  pinId?: string;
  rdoId?: string;
  pose?: TourPose;
  code?: string;
  ncStatus?: NcStatus;
  norma?: string;
  deadline?: string;
  evidences?: NcEvidence[];
  events?: NcEvent[];
  reopenCount?: number;
  contestation?: NcContestation;
}

export type RdoPeriod = "manha" | "tarde" | "noite";
export type RdoWeather = "bom" | "nublado" | "chuvoso" | "impraticavel";
export type RdoPhotoKind = "panoramica" | "detalhe" | "nao_conformidade" | "encoberto" | "seguranca";

export interface RdoCrewRow {
  id: string;
  role: string;
  qty: number;
}

export interface RdoPhoto {
  id: string;
  imageDataUrl: string;
  caption: string;
  kind: RdoPhotoKind;
  pose?: TourPose;
  createdAt: string;
}

export interface RdoStop {
  id: string;
  label: string;
  levelId?: string;
  imageDataUrl: string;
  photos: RdoPhoto[];
  pose?: TourPose;
  observation: string;
  aiStatus: "pendente" | "analisando" | "pronto" | "erro";
  aiSimulated?: boolean;
  issueIds: string[];
  createdAt: string;
}

export interface Rdo {
  id: string;
  projectId: string;
  number: number;
  date: string;
  responsible: string;
  weather: Record<RdoPeriod, RdoWeather>;
  workable: Record<RdoPeriod, boolean>;
  crew: RdoCrewRow[];
  equipment: RdoCrewRow[];
  servicesExecuted: string;
  occurrences: string;
  nonConformities: string;
  notes: string;
  analysisIds: string[];
  stops: RdoStop[];
  issueIds: string[];
  aiDrafted: boolean;
  aiSimulated: boolean;
  status: "rascunho" | "fechado";
  createdAt: string;
  closedAt?: string;
}

export interface AiAnalysis {
  id: string;
  projectId: string;
  createdAt: string;
  question: string;
  result: string;
  imageDataUrl: string;
  cameraPos?: MpPoint;
  simulated: boolean;
}

export interface FloorplanPin {
  id: string;
  x: number;
  y: number;
  label: string;
  note: string;
  issueId?: string;
  pose?: TourPose;
  createdAt: string;
}

export interface Floorplan {
  id: string;
  projectId: string;
  levelId?: string;
  name: string;
  imageSrc: string;
  analysis?: string;
  analysisAt?: string;
  analysisSimulated?: boolean;
  pins: FloorplanPin[];
  createdAt: string;
}
