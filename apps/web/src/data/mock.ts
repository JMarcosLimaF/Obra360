import type {
  Capture, Contractor, Issue, Level, NcAction, NcEvent, NcRole, NcStatus, Project, Rdo, SCurvePoint,
} from "../types";

export const CURRENT_USER = "Marcos Andrade";

/** As construtoras contratadas. Do outro lado da mesa da fiscalização. */
export const contractors: Contractor[] = [
  {
    id: "ctr-silva",
    razaoSocial: "Silva & Souza Engenharia e Construções Ltda.",
    cnpj: "12.345.678/0001-90",
    responsavelTecnico: "Eng. Civil Renato Silva",
    crea: "CREA-AL 0512345678",
    email: "obras@silvaesouza.eng.br",
    preposto: "Antônio Barros",
  },
  {
    id: "ctr-atlantico",
    razaoSocial: "Atlântico Construtora S.A.",
    cnpj: "98.765.432/0001-10",
    responsavelTecnico: "Eng. Civil Carla Menezes",
    crea: "CREA-AL 0598765432",
    email: "engenharia@atlanticoconstrutora.com.br",
    preposto: "Wagner Lopes",
  },
];

export const contractorById = (id?: string) => contractors.find((c) => c.id === id);

export const projects: Project[] = [
  {
    id: "prj-vista",
    name: "Residencial Vista do Parque",
    client: "Secretaria de Estado da Infraestrutura — SEINFRA/AL",
    address: "Av. das Araucárias, 1200 — Maceió/AL",
    progressPct: 62,
    plannedEnd: "2027-03-31",
    matterportId: "JKDH2SEKWcv",
    contractorId: "ctr-silva",
    contract: {
      numero: "CT 041/2025",
      processo: "E:01100.0000412/2025",
      orgaoContratante: "Secretaria de Estado da Infraestrutura — SEINFRA/AL",
      vigenciaInicio: "2025-11-03",
      vigenciaFim: "2027-05-03",
      valor: 18_740_000,
      fiscalDesignado: "Marcos Andrade",
      gestorDesignado: "Júlia Ferreira",
      portariaDesignacao: "Portaria SEINFRA nº 218/2025",
      prazos: { critica: 2, alta: 7, media: 15, baixa: 30 },
    },
  },
  {
    id: "prj-atlantico",
    name: "Ed. Comercial Atlântico",
    client: "Prefeitura Municipal de Maceió — SEMINFRA",
    address: "R. do Comércio, 45 — Maceió/AL",
    progressPct: 28,
    plannedEnd: "2027-11-30",
    contractorId: "ctr-atlantico",
    contract: {
      numero: "CT 007/2026",
      processo: "2026.0000731-4",
      orgaoContratante: "Prefeitura Municipal de Maceió — SEMINFRA",
      vigenciaInicio: "2026-02-10",
      vigenciaFim: "2027-12-10",
      valor: 9_120_000,
      fiscalDesignado: "Carlos Lima",
      gestorDesignado: "Júlia Ferreira",
      portariaDesignacao: "Portaria SEMINFRA nº 44/2026",
      prazos: { critica: 2, alta: 7, media: 15, baixa: 30 },
    },
  },
];

export const levels: Level[] = [
  { id: "lvl-terreo", projectId: "prj-vista", name: "Térreo", order: 0 },
  { id: "lvl-pav2", projectId: "prj-vista", name: "Pavimento 2", order: 1 },
  { id: "lvl-pav3", projectId: "prj-vista", name: "Pavimento 3 (tipo)", order: 2 },
  { id: "lvl-atl-terreo", projectId: "prj-atlantico", name: "Térreo", order: 0 },
];

export const captures: Capture[] = [
  { id: "cap-1", levelId: "lvl-terreo", date: "2026-07-10", author: "Júlia Ferreira", stage: "instalacoes" },
  { id: "cap-2", levelId: "lvl-terreo", date: "2026-08-21", author: "Pedro Santos", stage: "acabamento" },
  { id: "cap-3", levelId: "lvl-pav2", date: "2026-08-21", author: "Pedro Santos", stage: "instalacoes" },
  { id: "cap-4", levelId: "lvl-pav3", date: "2026-08-21", author: "Pedro Santos", stage: "alvenaria" },
  { id: "cap-5", levelId: "lvl-atl-terreo", date: "2026-08-19", author: "Carlos Lima", stage: "alvenaria" },
];

/** Atalho para escrever a trilha das pendências-semente sem repetir estrutura. */
const ev = (
  action: NcAction,
  to: NcStatus,
  date: string,
  actor: string,
  role: NcRole,
  note?: string,
  deadline?: string,
  visita?: { rdoId: string; rdoNumber: number },
): NcEvent => ({
  id: `ev-${action}-${date}-${Math.random().toString(36).slice(2, 6)}`,
  action, to, at: `${date}T09:00:00.000Z`, actor, role, note, deadline,
  rdoId: visita?.rdoId, rdoNumber: visita?.rdoNumber,
});

const FISCAL = "Marcos Andrade";
const PREPOSTO = "Antônio Barros";

export const seedIssues: Issue[] = [
  {
    id: "iss-1", projectId: "prj-vista", local: "Pavimento 2 · Cozinha", levelId: "lvl-pav2", origin: "manual",
    title: "Tubulação de esgoto fora do eixo",
    description: "Prumada da cozinha desalinhada 4 cm em relação ao projeto hidráulico.",
    discipline: "Hidráulica", severity: "alta", status: "aberto",
    assignee: "Hidrotec Instalações", dueDate: "2026-08-28",
    createdAt: "2026-08-21", createdBy: "Marcos Andrade",
  },
  {
    id: "iss-2", projectId: "prj-vista", local: "Pavimento 2 · Sala de Estar", levelId: "lvl-pav2", origin: "manual",
    title: "Fissura na viga V-204",
    description: "Fissura de retração aparente na face inferior. Solicitar avaliação estrutural.",
    discipline: "Estrutura", severity: "critica", status: "em_execucao",
    assignee: "Eng. Estrutural — Rafael", dueDate: "2026-09-05",
    createdAt: "2026-07-10", createdBy: "Júlia Ferreira",
    code: "NC-2026-002", ncStatus: "em_reparo", deadline: "2026-09-05",
    norma: "NBR 6118 — fissuração e durabilidade",
    evidences: [], reopenCount: 0,
    events: [
      ev("abertura", "rascunho", "2026-07-10", "Júlia Ferreira", "fiscalizacao"),
      ev("notificar", "notificada", "2026-07-10", FISCAL, "fiscalizacao", "Notificação emitida com prazo de 2 dias por severidade crítica.", "2026-07-12"),
      ev("dar_ciencia", "ciente", "2026-07-10", PREPOSTO, "construtora"),
      ev("iniciar_reparo", "em_reparo", "2026-07-11", PREPOSTO, "construtora", "Contratado laudo estrutural antes da intervenção.", "2026-09-05"),
    ],
  },
  {
    id: "iss-3", projectId: "prj-vista", local: "Pavimento 3 · Circulação", levelId: "lvl-pav3", origin: "manual",
    title: "Eletroduto sem fixação na laje",
    description: "Trecho de ~2 m solto antes do fechamento do forro.",
    discipline: "Elétrica", severity: "media", status: "aberto",
    assignee: "Voltec Elétrica", dueDate: "2026-09-02",
    createdAt: "2026-08-21", createdBy: "Pedro Santos",
  },
  {
    id: "iss-4", projectId: "prj-vista", local: "Térreo · Sala de Estar", levelId: "lvl-terreo", origin: "manual",
    title: "Piso com caimento invertido",
    description: "Água empoçando junto à porta da varanda. Refazer regularização.",
    discipline: "Acabamento", severity: "alta", status: "aguardando_verificacao",
    assignee: "Silva & Souza Engenharia", dueDate: "2026-08-25",
    createdAt: "2026-07-10", createdBy: "Marcos Andrade",
  },
  {
    id: "iss-5", projectId: "prj-vista", local: "Pavimento 2 · Suíte", levelId: "lvl-pav2", origin: "manual",
    title: "Alvenaria fora de prumo",
    description: "Parede da suíte com 2,5 cm de desaprumo em 2,6 m de pé-direito.",
    discipline: "Alvenaria", severity: "media", status: "resolvido",
    verifications: [{ rdoId: "rdo-seed-1", rdoNumber: 1, date: "2026-08-21", status: "resolvido", note: "Parede refeita e conferida com prumo a laser na visita." }],
    assignee: "Silva & Souza Engenharia", dueDate: "2026-07-20",
    createdAt: "2026-06-12", createdBy: "Júlia Ferreira",
    code: "NC-2026-005", ncStatus: "sanada", deadline: "2026-08-21",
    norma: "NBR 8545 — execução de alvenaria de vedação",
    evidences: [], reopenCount: 1,
    events: [
      ev("abertura", "rascunho", "2026-06-12", "Júlia Ferreira", "fiscalizacao"),
      ev("notificar", "notificada", "2026-06-12", FISCAL, "fiscalizacao", undefined, "2026-06-27"),
      ev("dar_ciencia", "ciente", "2026-06-13", PREPOSTO, "construtora"),
      ev("submeter_reparo", "reparo_submetido", "2026-06-24", PREPOSTO, "construtora", "Pano refeito no trecho apontado."),
      ev("reprovar", "em_reparo", "2026-06-26", FISCAL, "fiscalizacao", "Desaprumo remanescente de 1,8 cm; refazer o pano inteiro, não o trecho.", "2026-07-11"),
      ev("submeter_reparo", "reparo_submetido", "2026-08-19", PREPOSTO, "construtora", "Pano integralmente reexecutado."),
      ev("aprovar", "sanada", "2026-08-21", FISCAL, "fiscalizacao", "Conferido com prumo a laser na visita.", undefined, { rdoId: "rdo-seed-1", rdoNumber: 1 }),
    ],
  },
  {
    id: "iss-6", projectId: "prj-vista", local: "Térreo · Cozinha", levelId: "lvl-terreo", origin: "manual",
    title: "Bancada instalada sem ponto de gás",
    description: "Ponto de gás previsto em projeto não executado antes do fechamento.",
    discipline: "Hidráulica", severity: "alta", status: "aberto",
    assignee: "Hidrotec Instalações", dueDate: "2026-09-10",
    createdAt: "2026-08-21", createdBy: "Marcos Andrade",
  },
  {
    id: "iss-7", projectId: "prj-vista", local: "Pavimento 3 · Sala de Estar", levelId: "lvl-pav3", origin: "manual",
    title: "Falta de escoramento em balanço",
    description: "Escora removida antes do prazo de cura. Reinstalar imediatamente.",
    discipline: "Estrutura", severity: "critica", status: "resolvido",
    assignee: "Equipe própria", dueDate: "2026-06-15",
    createdAt: "2026-06-12", createdBy: "Pedro Santos",
    code: "NC-2026-007", ncStatus: "sanada", deadline: "2026-06-14",
    norma: "NR-18 item 18.7 — escoramento e cimbramento",
    evidences: [], reopenCount: 0,
    events: [
      ev("abertura", "rascunho", "2026-06-12", "Pedro Santos", "fiscalizacao"),
      ev("notificar", "notificada", "2026-06-12", FISCAL, "fiscalizacao", "Risco iminente: prazo de 2 dias.", "2026-06-14"),
      ev("dar_ciencia", "ciente", "2026-06-12", PREPOSTO, "construtora"),
      ev("submeter_reparo", "reparo_submetido", "2026-06-13", PREPOSTO, "construtora", "Escoras reinstaladas no mesmo dia."),
      ev("aprovar", "sanada", "2026-06-14", FISCAL, "fiscalizacao", "Escoramento conferido em campo."),
    ],
  },
  {
    id: "iss-8", projectId: "prj-vista", local: "Pavimento 2 · Circulação", levelId: "lvl-pav2", origin: "manual",
    title: "Contrapiso com espessura irregular",
    description: "Variação de 3 cm entre pontos medidos na circulação.",
    discipline: "Acabamento", severity: "baixa", status: "aberto",
    assignee: "Silva & Souza Engenharia", dueDate: "2026-09-18",
    createdAt: "2026-08-21", createdBy: "Júlia Ferreira",
  },
  {
    id: "iss-9", projectId: "prj-vista", local: "Pavimento 2 · Fachada norte", levelId: "lvl-pav2", origin: "manual",
    title: "Alvenaria fora de prumo na fachada norte",
    description: "Segundo pano com desaprumo acima da tolerância, executado pela mesma equipe do apontamento anterior.",
    discipline: "Alvenaria", severity: "media", status: "aberto",
    assignee: "Silva & Souza Engenharia", dueDate: "2026-08-27",
    createdAt: "2026-07-28", createdBy: "Marcos Andrade",
    code: "NC-2026-009", ncStatus: "notificada", deadline: "2026-08-12",
    norma: "NBR 8545 — execução de alvenaria de vedação",
    evidences: [], reopenCount: 0,
    events: [
      ev("abertura", "rascunho", "2026-07-28", FISCAL, "fiscalizacao"),
      ev("notificar", "notificada", "2026-07-28", FISCAL, "fiscalizacao", "Reincidência do desvio já apontado na NC-2026-005.", "2026-08-12"),
    ],
  },
];

/**
 * Uma visita já registrada, para o painel e o relatório nascerem com história.
 * É o RDO da captura de 21/08 — as frentes batem com os pavimentos e com as
 * pendências abertas naquele dia.
 */
const stop = (id: string, levelId: string, label: string, observation: string) => ({
  id, levelId, label,
  imageDataUrl: "",
  photos: [],
  observation,
  aiStatus: "pronto" as const,
  issueIds: [] as string[],
  createdAt: "2026-08-21T09:00:00.000Z",
});

export const seedRdos: Rdo[] = [
  {
    id: "rdo-seed-1",
    projectId: "prj-vista",
    number: 1,
    date: "2026-08-21",
    responsible: "Pedro Santos",
    weather: { manha: "bom", tarde: "nublado", noite: "bom" },
    workable: { manha: true, tarde: true, noite: true },
    crew: [
      { id: "c1", role: "Pedreiro", qty: 6 },
      { id: "c2", role: "Servente", qty: 8 },
      { id: "c3", role: "Eletricista", qty: 2 },
      { id: "c4", role: "Encanador", qty: 2 },
    ],
    equipment: [
      { id: "e1", role: "Betoneira", qty: 1 },
      { id: "e2", role: "Elevador cremalheira", qty: 1 },
    ],
    servicesExecuted:
      "Térreo: assentamento de piso cerâmico na sala e circulação; regularização de contrapiso concluída na varanda. " +
      "Pavimento 2: prumadas hidráulicas da cozinha e banhos em execução; reboco interno iniciado na suíte. " +
      "Pavimento 3: alvenaria de vedação em execução nas fachadas norte e leste.",
    occurrences:
      "Chuva fraca no início da tarde, sem paralisação dos serviços internos. " +
      "Entrega de 2 pallets de bloco cerâmico às 14h.",
    nonConformities:
      "Prumada de esgoto da cozinha do Pavimento 2 fora do eixo de projeto. " +
      "Eletroduto sem fixação em trecho da circulação do Pavimento 3, antes do fechamento do forro. " +
      "Bancada do Térreo instalada sem o ponto de gás previsto em projeto.",
    notes:
      "Cobrada da Hidrotec a correção da prumada antes do fechamento do shaft — serviço encoberto.",
    analysisIds: [],
    stops: [
      stop("st-1", "lvl-terreo", "Térreo", "Piso assentado na sala; caimento da varanda ainda invertido junto à porta."),
      stop("st-2", "lvl-pav2", "Pavimento 2", "Prumadas em execução; desalinhamento da cozinha confirmado em campo."),
      stop("st-3", "lvl-pav3", "Pavimento 3 (tipo)", "Alvenaria avançando; eletroduto solto no trecho da circulação."),
    ],
    issueIds: ["iss-1", "iss-3", "iss-6", "iss-8"],
    aiDrafted: false,
    aiSimulated: false,
    status: "fechado",
    createdAt: "2026-08-21T09:00:00.000Z",
    closedAt: "2026-08-21T17:30:00.000Z",
  },
];

export const sCurve: SCurvePoint[] = [
  { month: "Mar", planned: 8, actual: 7 },
  { month: "Abr", planned: 16, actual: 14 },
  { month: "Mai", planned: 26, actual: 23 },
  { month: "Jun", planned: 37, actual: 34 },
  { month: "Jul", planned: 49, actual: 46 },
  { month: "Ago", planned: 60, actual: 62 },
  { month: "Set", planned: 71, actual: null },
  { month: "Out", planned: 81, actual: null },
  { month: "Nov", planned: 90, actual: null },
  { month: "Dez", planned: 97, actual: null },
];

// ---------------------------------------------------------------------------
// Helpers de consulta
// ---------------------------------------------------------------------------

export const projectById = (id: string) => projects.find((p) => p.id === id);
export const levelsOf = (projectId: string) =>
  levels.filter((l) => l.projectId === projectId).sort((a, b) => a.order - b.order);
export const capturesOf = (levelId: string) =>
  captures.filter((c) => c.levelId === levelId).sort((a, b) => a.date.localeCompare(b.date));

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
