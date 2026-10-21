export type Stage = "estrutura" | "alvenaria" | "instalacoes" | "acabamento";

export const STAGE_LABEL: Record<Stage, string> = {
  estrutura: "Estrutura",
  alvenaria: "Alvenaria",
  instalacoes: "Instalações & Reboco",
  acabamento: "Acabamento",
};

/** A construtora que executa a obra — do outro lado da mesa da fiscalização. */
export interface Contractor {
  id: string;
  razaoSocial: string;
  cnpj: string;
  responsavelTecnico: string;
  crea: string;
  email: string;
  /** representante da contratada na obra, quem recebe as notificações */
  preposto: string;
}

/** O contrato administrativo. É ele que dá força às notificações e aos prazos. */
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
  /** prazo de reparo por severidade, em dias corridos */
  prazos: Record<IssueSeverity, number>;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  address: string;
  progressPct: number;
  plannedEnd: string;
  /** id de modelo Matterport vinculado à obra (fonte 360 do viewer) */
  matterportId?: string;
  /** foto de capa enviada para a obra; sem ela, a lista usa a miniatura do Matterport */
  coverUrl?: string;
  /** construtora responsável pela execução */
  contractorId?: string;
  /** contrato administrativo que rege a obra */
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
  date: string; // ISO
  author: string;
  stage: Stage;
}

/** Coordenada 3D no espaço do modelo Matterport */
export interface MpPoint {
  x: number;
  y: number;
  z: number;
}

export type IssueStatus = "aberto" | "em_execucao" | "aguardando_verificacao" | "resolvido";
export type IssueSeverity = "baixa" | "media" | "alta" | "critica";

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  aberto: "Aberto",
  em_execucao: "Em execução",
  aguardando_verificacao: "Aguard. verificação",
  resolvido: "Resolvido",
};

/** Posição da câmera no tour — serve ao RDO, ao pino de planta e à pendência. */
export interface TourPose {
  sweep: string;
  rotation: { x: number; y: number };
}

/** De onde a pendência nasceu — é o que permite voltar à origem. */
export type IssueOrigin = "viewer" | "planta" | "rdo" | "manual";

export const ISSUE_ORIGIN_LABEL: Record<IssueOrigin, string> = {
  viewer: "Tour 360",
  planta: "Planta",
  rdo: "Diário de obra",
  manual: "Cadastro",
};

/**
 * LEGADO. A verificação virou um evento do trâmite (`NcEvent` com `rdoId`), para
 * não existirem duas memórias do mesmo ato. Este tipo só sobrevive para ler
 * acervos gravados antes da unificação — a migração os converte em eventos.
 */
export interface IssueVerification {
  rdoId: string;
  rdoNumber: number;
  date: string;
  status: IssueStatus;
  note?: string;
}

// ---------------------------------------------------------------------------
// Não conformidade — o ciclo entre fiscalização e construtora
// ---------------------------------------------------------------------------

/**
 * Estado formal da não conformidade. `Issue.status` continua existindo como a
 * leitura grosseira que as telas antigas usam; `ncStatus` é o estado real do
 * trâmite, e quem manda nele é `lib/nc-flow.ts`.
 */
export type NcStatus =
  | "rascunho"
  | "notificada"
  | "ciente"
  | "em_reparo"
  | "reparo_submetido"
  | "contestada"
  | "sanada"
  | "cancelada";

export const NC_STATUS_LABEL: Record<NcStatus, string> = {
  rascunho: "Rascunho",
  notificada: "Notificada",
  ciente: "Ciência dada",
  em_reparo: "Em reparo",
  reparo_submetido: "Reparo submetido",
  contestada: "Contestada",
  sanada: "Sanada",
  cancelada: "Cancelada",
};

/** Quem está atuando. Sem autenticação, é um seletor de demonstração. */
export type NcRole = "fiscalizacao" | "construtora" | "gestor";

export const NC_ROLE_LABEL: Record<NcRole, string> = {
  fiscalizacao: "Fiscalização",
  construtora: "Construtora",
  gestor: "Gestor do contrato",
};

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

export const NC_ACTION_LABEL: Record<NcAction, string> = {
  abertura: "Abertura do apontamento",
  notificar: "Notificação emitida",
  dar_ciencia: "Ciência da contratada",
  iniciar_reparo: "Início do reparo",
  submeter_reparo: "Reparo submetido",
  aprovar: "Reparo aprovado",
  reprovar: "Reparo reprovado",
  contestar: "Contestação apresentada",
  decidir_contestacao: "Decisão da contestação",
  prorrogar: "Prazo prorrogado",
  reiterar: "Notificação reiterada",
  cancelar: "Apontamento cancelado",
  anexar_evidencia: "Evidência anexada",
  retificar: "Retificação de conteúdo",
};

/** A que momento do ciclo a imagem pertence — é o que forma o par antes/depois. */
export type NcEvidenceKind = "abertura" | "reparo" | "verificacao";

export const NC_EVIDENCE_LABEL: Record<NcEvidenceKind, string> = {
  abertura: "Abertura",
  reparo: "Reparo executado",
  verificacao: "Verificação",
};

export interface NcEvidence {
  id: string;
  kind: NcEvidenceKind;
  imageDataUrl: string;
  /** vista do tour de onde a imagem saiu, para conferir o mesmo ângulo depois */
  pose?: TourPose;
  author: string;
  role: NcRole;
  note: string;
  createdAt: string;
}

/** Cada passo do trâmite vira um evento. Nada é apagado, nada é sobrescrito. */
export interface NcEvent {
  id: string;
  action: NcAction;
  from?: NcStatus;
  to: NcStatus;
  at: string;
  actor: string;
  role: NcRole;
  note?: string;
  /** prazo vigente após o evento */
  deadline?: string;
  /** visita em que o ato foi praticado, quando veio do diário de obra */
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
  /** descrição textual do local (pavimento/ambiente) */
  local: string;
  /** âncora 3D no modelo Matterport (presente quando marcada pelo viewer) */
  mp?: MpPoint;
  /** vértices do polígono 3D quando a ocorrência delimita uma área */
  mpPolygon?: MpPoint[];
  /** área aproximada do polígono em m² */
  areaM2?: number;
  /** id do tag criado no Matterport (sessão atual) */
  tagId?: string;
  title: string;
  description: string;
  discipline: string;
  severity: IssueSeverity;
  status: IssueStatus;
  assignee: string;
  dueDate: string;
  createdAt: string;
  createdBy: string;
  /** pavimento a que pertence — chave que liga planta, tour, RDO e relatório */
  levelId?: string;
  /** de onde nasceu, para a trilha de volta */
  origin?: IssueOrigin;
  /** procedência na planta */
  floorplanId?: string;
  pinId?: string;
  /** RDO em que foi aberta */
  rdoId?: string;
  /** posição no tour (pino de planta ou foto de visita) */
  pose?: TourPose;
  /** @deprecated convertido em `events` na migração; ver lib/nc-flow */
  verifications?: IssueVerification[];

  // --- trâmite formal com a construtora (ver lib/nc-flow.ts) ---
  /** identificação da peça: NC-2026-014 */
  code?: string;
  /** estado real do trâmite; `status` é a leitura grosseira das telas antigas */
  ncStatus?: NcStatus;
  /** norma ou cláusula que fundamenta a exigência */
  norma?: string;
  /** prazo de reparo vigente, imposto pela severidade na notificação */
  deadline?: string;
  evidences?: NcEvidence[];
  events?: NcEvent[];
  /** quantas vezes o reparo foi reprovado */
  reopenCount?: number;
  contestation?: NcContestation;
}

// ---------------------------------------------------------------------------
// Diário de Obra (RDO)
// ---------------------------------------------------------------------------

export type RdoPeriod = "manha" | "tarde" | "noite";
export type RdoWeather = "bom" | "nublado" | "chuvoso" | "impraticavel";

export const RDO_PERIOD_LABEL: Record<RdoPeriod, string> = {
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
};

export const RDO_WEATHER_LABEL: Record<RdoWeather, string> = {
  bom: "Bom",
  nublado: "Nublado",
  chuvoso: "Chuvoso",
  impraticavel: "Impraticável",
};

export interface RdoCrewRow {
  id: string;
  role: string;
  qty: number;
}

export type RdoStopPose = TourPose;

/** Classificação da foto — organiza o anexo e alimenta o dossiê de encoberto. */
export type RdoPhotoKind = "panoramica" | "detalhe" | "nao_conformidade" | "encoberto" | "seguranca";

export const RDO_PHOTO_KIND_LABEL: Record<RdoPhotoKind, string> = {
  panoramica: "Panorâmica",
  detalhe: "Detalhe",
  nao_conformidade: "Não conformidade",
  encoberto: "Serviço encoberto",
  seguranca: "Segurança",
};

/** Uma foto do registro: imagem, legenda, classificação e de onde foi tirada. */
export interface RdoPhoto {
  id: string;
  imageDataUrl: string;
  caption: string;
  kind: RdoPhotoKind;
  pose?: RdoStopPose;
  createdAt: string;
}

/** Uma parada da visita: o que foi visto, de onde, e o que virou pendência. */
export interface RdoStop {
  id: string;
  label: string;
  levelId?: string;
  /** capa da frente (primeira foto) */
  imageDataUrl: string;
  /** todas as fotos desta frente, na ordem em que foram tiradas */
  photos: RdoPhoto[];
  pose?: RdoStopPose;
  observation: string;
  aiStatus: "pendente" | "analisando" | "pronto" | "erro";
  aiSimulated?: boolean;
  issueIds: string[];
  createdAt: string;
}

export interface Rdo {
  id: string;
  projectId: string;
  /** número sequencial do relatório dentro da obra */
  number: number;
  date: string; // ISO (aaaa-mm-dd)
  responsible: string;
  /** condição do tempo e praticabilidade por período */
  weather: Record<RdoPeriod, RdoWeather>;
  workable: Record<RdoPeriod, boolean>;
  crew: RdoCrewRow[];
  equipment: RdoCrewRow[];
  servicesExecuted: string;
  occurrences: string;
  nonConformities: string;
  notes: string;
  /** análises de IA usadas como anexo fotográfico (fluxo antigo) */
  analysisIds: string[];
  /** pontos de vistoria registrados na visita guiada, em ordem de caminhada */
  stops: RdoStop[];
  /** pendências citadas no relatório */
  issueIds: string[];
  /** rascunho de IA já aplicado ao texto */
  aiDrafted: boolean;
  aiSimulated: boolean;
  status: "rascunho" | "fechado";
  createdAt: string;
  closedAt?: string;
}

/** Ponto da curva S */
export interface SCurvePoint {
  month: string;
  planned: number;
  actual: number | null;
}

/** Análise de IA generativa sobre a vista atual do panorama */
export interface AiAnalysis {
  id: string;
  projectId: string;
  createdAt: string;
  question: string;
  result: string;
  /** screenshot da vista analisada (data URL) */
  imageDataUrl: string;
  /** posição da câmera no momento da análise */
  cameraPos?: MpPoint;
  simulated: boolean;
}

// ---------------------------------------------------------------------------
// Plantas baixas — o projeto entrando no sistema
// ---------------------------------------------------------------------------

/** Marcação feita sobre a planta, em coordenadas relativas (0..1). */
export interface FloorplanPin {
  id: string;
  x: number;
  y: number;
  label: string;
  note: string;
  /** pendência criada a partir desta marcação */
  issueId?: string;
  /** vista do tour capturada quando o ponto foi marcado de dentro do 360 */
  pose?: TourPose;
  createdAt: string;
}

export interface Floorplan {
  id: string;
  projectId: string;
  levelId?: string;
  name: string;
  /** URL pública ou data URL da imagem do desenho */
  imageSrc: string;
  /** leitura da planta feita pela IA */
  analysis?: string;
  analysisAt?: string;
  analysisSimulated?: boolean;
  pins: FloorplanPin[];
  createdAt: string;
}
