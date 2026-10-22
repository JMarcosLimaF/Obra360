import { create } from "zustand";
import { api, ApiError } from "./api/client";
import type { AiAnalysis, Capture, Contractor, Floorplan, FloorplanPin, Issue, Level, MpPoint, NcAction, NcEvidence, NcRole, Project, Rdo, RdoPhoto, RdoStop, TourPose } from "./types";
import { load, save, snapshot } from "./lib/persist";
import { apply as ncApply, statusGrosseiro, type ApplyPayload } from "./lib/nc-flow";
import { downscaleDataUrl } from "./lib/image";
import type { ProjectPayload } from "./lib/new-project";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOr = (id?: string) => (id && UUID.test(id) ? id : undefined);

interface SessionPayload {
  user: { id: string; name: string; email: string };
  memberships: { ncRole: NcRole | null }[];
  aiConfigured: boolean;
}

interface BootstrapPayload {
  orgName: string;
  projects: Project[];
  contractors: Contractor[];
  levels: Level[];
  captures: Capture[];
  issues: Issue[];
}

function evidenceBody(ev?: NcEvidence) {
  if (!ev?.imageDataUrl) return undefined;
  return {
    kind: ev.kind,
    image: ev.imageDataUrl,
    pose: ev.pose,
    note: ev.note,
    takenAt: ev.createdAt,
  };
}

const LS_MP_KEY = "obra360.mpSdkKey";
const LS_AI_KEY = "obra360.anthropicKey";

/** applicationKey do Matterport SDK for Embeds (chave pública de cliente).
 *  Pode ser sobrescrita nas configurações (engrenagem) do viewer. */
const DEFAULT_MP_SDK_KEY = import.meta.env.VITE_MP_SDK_KEY || "7xcc5p5tdquzprbzfb0qw5std";

/** A chave da OpenAI fica no servidor. Este valor só preserva o que já estava gravado no navegador. */
const DEFAULT_AI_KEY = "";

function lsGet(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* modo privado */ }
}

const emptyRdo = (projectId: string, number: number, date: string, author: string): Rdo => ({
  id: `rdo-${Date.now()}`,
  projectId,
  number,
  date,
  responsible: author,
  weather: { manha: "bom", tarde: "bom", noite: "bom" },
  workable: { manha: true, tarde: true, noite: true },
  crew: [
    { id: "c1", role: "Pedreiro", qty: 0 },
    { id: "c2", role: "Servente", qty: 0 },
  ],
  equipment: [],
  servicesExecuted: "",
  occurrences: "",
  nonConformities: "",
  notes: "",
  analysisIds: [],
  stops: [],
  issueIds: [],
  aiDrafted: false,
  aiSimulated: false,
  status: "rascunho",
  createdAt: new Date().toISOString(),
});

interface AppState {
  sessionStatus: "checking" | "anon" | "in";
  catalogReady: boolean;
  bootError: string | null;
  orgName: string;
  aiConfigured: boolean;
  projects: Project[];
  levels: Level[];
  captures: Capture[];
  contractors: Contractor[];
  restoreSession: () => Promise<void>;
  /** envia a foto de capa da obra; devolve a mensagem de erro, se houver */
  setProjectCover: (projectId: string, image: string) => Promise<string | null>;
  /** cadastra a obra (com pavimentos, contratada e contrato) e a coloca na lista */
  createProject: (payload: ProjectPayload) => Promise<{ project?: Project; warnings?: string[]; error?: string }>;

  user: string | null;
  userEmail: string | null;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;

  mpSdkKey: string;
  anthropicKey: string;
  setKeys: (mp: string, ai: string) => void;

  /** avisa quando o navegador recusou gravar (cota cheia / modo privado) */
  storageWarning: string | null;
  clearStorageWarning: () => void;

  /** papel em que o usuário está atuando — seletor de demonstração, não login */
  activeRole: NcRole;
  setActiveRole: (role: NcRole) => void;

  issues: Issue[];
  addIssue: (issue: Omit<Issue, "id" | "createdAt" | "createdBy" | "status">) => Issue;
  /** aplica uma ação do trâmite; devolve a mensagem de erro quando a regra barra */
  ncTransition: (issueId: string, action: NcAction, payload: Omit<ApplyPayload, "actor" | "role">) => string | null;
  /**
   * Corrige o conteúdo da peça. Em rascunho é edição simples; depois de emitida
   * exige razão e vira retificação registrada no histórico.
   */
  editIssue: (id: string, patch: Partial<Issue>, razao?: string) => string | null;
  /** substitui/insere NCs vindas de um pacote de tramitação */
  mergeIssues: (incoming: Issue[]) => { novas: number; atualizadas: number };
  setIssueTagId: (id: string, tagId: string) => void;

  analyses: AiAnalysis[];
  addAnalysis: (a: Omit<AiAnalysis, "id" | "createdAt">) => void;

  rdos: Rdo[];
  createRdo: (projectId: string, date: string) => Rdo;
  addRdoStop: (rdoId: string, stop: RdoStop) => void;
  updateRdoStop: (rdoId: string, stopId: string, patch: Partial<RdoStop>) => void;
  removeRdoStop: (rdoId: string, stopId: string) => void;
  addRdoPhoto: (rdoId: string, stopId: string, photo: RdoPhoto) => void;
  updateRdoPhoto: (rdoId: string, stopId: string, photoId: string, patch: Partial<RdoPhoto>) => void;
  removeRdoPhoto: (rdoId: string, stopId: string, photoId: string) => void;
  updateRdo: (id: string, patch: Partial<Rdo>) => void;
  closeRdo: (id: string) => void;
  deleteRdo: (id: string) => void;

  floorplans: Floorplan[];
  addFloorplan: (fp: Floorplan) => void;
  updateFloorplan: (id: string, patch: Partial<Floorplan>) => void;
  removeFloorplan: (id: string) => void;
  addFloorplanPin: (planId: string, pin: FloorplanPin) => void;
  updateFloorplanPin: (planId: string, pinId: string, patch: Partial<FloorplanPin>) => void;
  removeFloorplanPin: (planId: string, pinId: string) => void;

  pendingAnchor: MpPoint | null;
  setPendingAnchor: (p: MpPoint | null) => void;
  /** vista congelada no instante em que o ponto foi marcado, já com a mira */
  pendingShot: NcEvidence | null;
  setPendingShot: (e: NcEvidence | null) => void;
  pendingPolygon: MpPoint[] | null;
  setPendingPolygon: (pts: MpPoint[] | null) => void;

  flyToIssueId: string | null;
  requestFlyTo: (id: string | null) => void;
  /** pedido de voo por vista salva (pino de planta, foto de visita) */
  flyToPose: TourPose | null;
  requestFlyToPose: (pose: TourPose | null) => void;
}

async function pullCatalog(): Promise<void> {
  const data = await api<BootstrapPayload>("/api/bootstrap");
  useApp.setState({
    orgName: data.orgName,
    projects: data.projects,
    contractors: data.contractors,
    levels: data.levels,
    captures: data.captures,
    issues: data.issues,
    catalogReady: true,
    bootError: null,
  });
}

function applySession(session: SessionPayload): void {
  const role = session.memberships.find((m) => m.ncRole)?.ncRole ?? "fiscalizacao";
  useApp.setState({
    user: session.user.name,
    userEmail: session.user.email,
    activeRole: role,
    aiConfigured: session.aiConfigured,
    sessionStatus: "in",
    bootError: null,
  });
}

export const useApp = create<AppState>((set, get) => ({
  sessionStatus: "checking",
  catalogReady: false,
  bootError: null,
  orgName: "",
  aiConfigured: false,
  projects: [],
  levels: [],
  captures: [],
  contractors: [],
  restoreSession: async () => {
    try {
      const session = await api<SessionPayload>("/api/auth/me");
      applySession(session);
      await pullCatalog();
    } catch (err) {
      const offline = err instanceof ApiError && err.status === 0;
      set({
        user: null,
        userEmail: null,
        sessionStatus: "anon",
        catalogReady: false,
        bootError: offline ? err.message : null,
      });
    }
  },
  createProject: async (payload) => {
    try {
      // a capa vira miniatura nos cards: 1280 px de largura já sobram
      const cover = payload.cover ? await downscaleDataUrl(payload.cover, 1280, 0.82) : undefined;
      const created = await api<{ project: Project; levels: Level[]; contractor?: Contractor; warnings?: string[] }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ ...payload, cover }),
      });
      set((s) => ({
        projects: [...s.projects, created.project].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        levels: [...s.levels, ...created.levels],
        contractors: created.contractor
          ? [...s.contractors, created.contractor].sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial, "pt-BR"))
          : s.contractors,
      }));
      return { project: created.project, warnings: created.warnings ?? [] };
    } catch (err) {
      return { error: err instanceof ApiError ? err.message : "Não foi possível cadastrar a obra." };
    }
  },
  setProjectCover: async (projectId, image) => {
    try {
      // a capa aparece como miniatura no card: 1280 px de largura já sobram
      const reduced = await downscaleDataUrl(image, 1280, 0.82);
      const { coverUrl } = await api<{ coverUrl: string }>(`/api/projects/${projectId}/cover`, {
        method: "PUT",
        body: JSON.stringify({ image: reduced }),
      });
      set((s) => ({ projects: s.projects.map((p) => (p.id === projectId ? { ...p, coverUrl } : p)) }));
      return null;
    } catch (err) {
      return err instanceof ApiError ? err.message : "Não foi possível enviar a foto.";
    }
  },

  user: null,
  userEmail: null,
  login: async (email, password) => {
    try {
      const session = await api<SessionPayload>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      applySession(session);
      await pullCatalog();
      return null;
    } catch (err) {
      return err instanceof ApiError ? err.message : "Não foi possível entrar.";
    }
  },
  logout: async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    set({
      user: null,
      userEmail: null,
      sessionStatus: "anon",
      catalogReady: false,
      projects: [],
      levels: [],
      captures: [],
      contractors: [],
      issues: [],
      orgName: "",
    });
  },

  mpSdkKey: lsGet(LS_MP_KEY) || DEFAULT_MP_SDK_KEY,
  anthropicKey: lsGet(LS_AI_KEY) || DEFAULT_AI_KEY,
  setKeys: (mp, ai) => {
    lsSet(LS_MP_KEY, mp);
    lsSet(LS_AI_KEY, ai);
    set({ mpSdkKey: mp, anthropicKey: ai });
  },

  storageWarning: null,
  clearStorageWarning: () => set({ storageWarning: null }),

  activeRole: load<NcRole>("activeRole", "fiscalizacao"),
  setActiveRole: (role) => set({ activeRole: role }),

  issues: [],
  addIssue: (data) => {
    const actor = get().user ?? "Fiscalização";
    const now = new Date().toISOString();
    const tempId = `tmp-${crypto.randomUUID()}`;
    const issue: Issue = {
      ...data,
      id: tempId,
      ncStatus: "rascunho",
      status: statusGrosseiro("rascunho"),
      evidences: data.evidences ?? [],
      reopenCount: 0,
      events: [],
      createdAt: now.slice(0, 10),
      createdBy: actor,
    };
    set((s) => ({ issues: [...s.issues, issue], pendingAnchor: null, pendingPolygon: null }));
    const shot = data.evidences?.[0];
    void api<Issue>(`/api/projects/${data.projectId}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: data.title,
        description: data.description,
        discipline: data.discipline,
        severity: data.severity,
        local: data.local,
        assignee: data.assignee,
        norma: data.norma,
        levelId: uuidOr(data.levelId),
        origin: data.origin,
        floorplanId: uuidOr(data.floorplanId),
        pinId: uuidOr(data.pinId),
        rdoId: uuidOr(data.rdoId),
        pose: data.pose,
        mp: data.mp,
        mpPolygon: data.mpPolygon,
        areaM2: data.areaM2,
        evidence: evidenceBody(shot),
      }),
    }).then((saved) => {
      set((s) => ({
        issues: s.issues.map((i) => (i.id === tempId ? saved : i)),
        floorplans: s.floorplans.map((f) => ({
          ...f,
          pins: f.pins.map((p) => (p.issueId === tempId ? { ...p, issueId: saved.id } : p)),
        })),
      }));
    }).catch((err) => {
      set((s) => ({
        issues: s.issues.filter((i) => i.id !== tempId),
        storageWarning: err instanceof Error ? err.message : "Não foi possível abrir a não conformidade.",
      }));
    });
    return issue;
  },
  ncTransition: (issueId, action, payload) => {
    const state = get();
    const nc = state.issues.find((i) => i.id === issueId);
    if (!nc) return "Não conformidade não encontrada.";
    if (issueId.startsWith("tmp-")) return "A peça ainda está sendo gravada. Tente de novo em instantes.";
    try {
      const next = ncApply(nc, action, {
        ...payload,
        actor: state.user ?? "Fiscalização",
        role: state.activeRole,
      });
      set((s) => ({ issues: s.issues.map((i) => (i.id === issueId ? next : i)) }));
      void api<Issue>(`/api/issues/${issueId}/transition`, {
        method: "POST",
        body: JSON.stringify({
          action,
          note: payload.note,
          decisao: payload.decisao,
          prazoDias: payload.prazoDias,
          rdoId: uuidOr(payload.rdoId),
          evidence: evidenceBody(payload.evidence),
        }),
      }).then((saved) => {
        set((s) => ({ issues: s.issues.map((i) => (i.id === issueId ? saved : i)) }));
      }).catch((err) => {
        set((s) => ({
          issues: s.issues.map((i) => (i.id === issueId ? nc : i)),
          storageWarning: err instanceof Error ? err.message : "O servidor recusou o ato.",
        }));
      });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Não foi possível aplicar a ação.";
    }
  },
  editIssue: (id, patch, razao) => {
    const state = get();
    const nc = state.issues.find((i) => i.id === id);
    if (!nc) return "Não conformidade não encontrada.";
    const emitida = (nc.ncStatus ?? "rascunho") !== "rascunho";
    if (emitida && !razao?.trim()) {
      return "Esta peça já foi emitida. Informe a razão da retificação.";
    }
    let atualizada: Issue = { ...nc, ...patch };
    if (emitida) {
      try {
        atualizada = ncApply(atualizada, "retificar", {
          actor: state.user ?? "Fiscalização",
          role: state.activeRole,
          note: razao,
        });
      } catch (err) {
        return err instanceof Error ? err.message : "Não foi possível retificar.";
      }
    }
    set((s) => ({ issues: s.issues.map((i) => (i.id === id ? atualizada : i)) }));
    void api<Issue>(`/api/issues/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: patch.title,
        description: patch.description,
        discipline: patch.discipline,
        severity: patch.severity,
        norma: patch.norma,
        assignee: patch.assignee,
        local: patch.local,
        razao,
      }),
    }).then((saved) => {
      set((s) => ({ issues: s.issues.map((i) => (i.id === id ? saved : i)) }));
    }).catch((err) => {
      set((s) => ({
        issues: s.issues.map((i) => (i.id === id ? nc : i)),
        storageWarning: err instanceof Error ? err.message : "O servidor recusou a edição.",
      }));
    });
    return null;
  },
  mergeIssues: (incoming) => {
    let novas = 0;
    let atualizadas = 0;
    set((s) => {
      const byCode = new Map(s.issues.map((i) => [i.code ?? i.id, i]));
      for (const inc of incoming) {
        const key = inc.code ?? inc.id;
        const mine = byCode.get(key);
        if (!mine) {
          byCode.set(key, inc);
          novas++;
          continue;
        }
        // conciliação idempotente: vence quem tem mais histórico, nunca o mais antigo
        const meus = mine.events?.length ?? 0;
        const deles = inc.events?.length ?? 0;
        if (deles > meus) {
          byCode.set(key, { ...inc, id: mine.id });
          atualizadas++;
        }
      }
      return { issues: [...byCode.values()] };
    });
    return { novas, atualizadas };
  },
  setIssueTagId: (id, tagId) =>
    set((s) => ({ issues: s.issues.map((i) => (i.id === id ? { ...i, tagId } : i)) })),


  analyses: load<AiAnalysis[]>("analyses", []),
  addAnalysis: (a) => {
    const id = `ana-${Date.now()}`;
    const record: AiAnalysis = { ...a, id, createdAt: new Date().toISOString() };
    set((s) => ({ analyses: [record, ...s.analyses] }));
    // guarda uma miniatura no lugar do screenshot cheio (cota do navegador)
    void downscaleDataUrl(a.imageDataUrl).then((small) => {
      if (small === a.imageDataUrl) return;
      set((s) => ({
        analyses: s.analyses.map((x) => (x.id === id ? { ...x, imageDataUrl: small } : x)),
      }));
    });
  },

  rdos: load<Rdo[]>("rdos", []).map((r) => ({
    ...r,
    stops: (r.stops ?? []).map((t) => ({
      ...t,
      photos: t.photos ?? (t.imageDataUrl
        ? [{ id: `ph-${t.id}`, imageDataUrl: t.imageDataUrl, caption: "", kind: "panoramica" as const, pose: t.pose, createdAt: t.createdAt }]
        : []),
    })),
  })),
  createRdo: (projectId, date) => {
    const mine = get().rdos.filter((r) => r.projectId === projectId);
    const next = mine.reduce((m, r) => Math.max(m, r.number), 0) + 1;
    const rdo = emptyRdo(projectId, next, date, get().user ?? "Fiscalização");
    set((s) => ({ rdos: [rdo, ...s.rdos] }));
    return rdo;
  },
  addRdoStop: (rdoId, stop) =>
    set((s) => ({
      rdos: s.rdos.map((r) => (r.id === rdoId ? { ...r, stops: [...r.stops, stop] } : r)),
    })),
  updateRdoStop: (rdoId, stopId, patch) =>
    set((s) => ({
      rdos: s.rdos.map((r) =>
        r.id === rdoId
          ? { ...r, stops: r.stops.map((t) => (t.id === stopId ? { ...t, ...patch } : t)) }
          : r,
      ),
    })),
  removeRdoStop: (rdoId, stopId) =>
    set((s) => ({
      rdos: s.rdos.map((r) =>
        r.id === rdoId ? { ...r, stops: r.stops.filter((t) => t.id !== stopId) } : r,
      ),
    })),
  addRdoPhoto: (rdoId, stopId, photo) =>
    set((s) => ({
      rdos: s.rdos.map((r) =>
        r.id === rdoId
          ? {
              ...r,
              stops: r.stops.map((t) =>
                t.id === stopId
                  ? {
                      ...t,
                      photos: [...t.photos, photo],
                      // a primeira foto vira a capa da frente
                      imageDataUrl: t.photos.length === 0 ? photo.imageDataUrl : t.imageDataUrl,
                    }
                  : t,
              ),
            }
          : r,
      ),
    })),
  updateRdoPhoto: (rdoId, stopId, photoId, patch) =>
    set((s) => ({
      rdos: s.rdos.map((r) =>
        r.id === rdoId
          ? {
              ...r,
              stops: r.stops.map((t) =>
                t.id === stopId
                  ? { ...t, photos: t.photos.map((f) => (f.id === photoId ? { ...f, ...patch } : f)) }
                  : t,
              ),
            }
          : r,
      ),
    })),
  removeRdoPhoto: (rdoId, stopId, photoId) =>
    set((s) => ({
      rdos: s.rdos.map((r) =>
        r.id === rdoId
          ? {
              ...r,
              stops: r.stops.map((t) => {
                if (t.id !== stopId) return t;
                const photos = t.photos.filter((f) => f.id !== photoId);
                return { ...t, photos, imageDataUrl: photos[0]?.imageDataUrl ?? t.imageDataUrl };
              }),
            }
          : r,
      ),
    })),
  updateRdo: (id, patch) =>
    set((s) => ({ rdos: s.rdos.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  closeRdo: (id) =>
    set((s) => ({
      rdos: s.rdos.map((r) =>
        r.id === id ? { ...r, status: "fechado", closedAt: new Date().toISOString() } : r,
      ),
    })),
  deleteRdo: (id) => set((s) => ({ rdos: s.rdos.filter((r) => r.id !== id) })),

  floorplans: load<Floorplan[]>("floorplans", []).map((f) => ({ ...f, pins: f.pins ?? [] })),
  addFloorplan: (fp) => set((s) => ({ floorplans: [...s.floorplans, fp] })),
  updateFloorplan: (id, patch) =>
    set((s) => ({ floorplans: s.floorplans.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
  removeFloorplan: (id) => set((s) => ({ floorplans: s.floorplans.filter((f) => f.id !== id) })),
  addFloorplanPin: (planId, pin) =>
    set((s) => ({
      floorplans: s.floorplans.map((f) => (f.id === planId ? { ...f, pins: [...f.pins, pin] } : f)),
    })),
  updateFloorplanPin: (planId, pinId, patch) =>
    set((s) => ({
      floorplans: s.floorplans.map((f) =>
        f.id === planId ? { ...f, pins: f.pins.map((p) => (p.id === pinId ? { ...p, ...patch } : p)) } : f,
      ),
    })),
  removeFloorplanPin: (planId, pinId) =>
    set((s) => ({
      floorplans: s.floorplans.map((f) =>
        f.id === planId ? { ...f, pins: f.pins.filter((p) => p.id !== pinId) } : f,
      ),
    })),

  pendingAnchor: null,
  setPendingAnchor: (p) =>
    set({ pendingAnchor: p, ...(p === null ? { pendingPolygon: null, pendingShot: null } : {}) }),
  pendingShot: null,
  setPendingShot: (e) => set({ pendingShot: e }),
  pendingPolygon: null,
  setPendingPolygon: (pts) => set({ pendingPolygon: pts }),

  flyToIssueId: null,
  requestFlyTo: (id) => set({ flyToIssueId: id }),
  flyToPose: null,
  requestFlyToPose: (pose) => set({ flyToPose: pose }),
}));

// ---------------------------------------------------------------------------
// Gravação automática (enquanto não há backend)
// ---------------------------------------------------------------------------

const PERSISTED = ["analyses", "rdos", "floorplans"] as const;
let writeTimer: number | undefined;

useApp.subscribe((state, prev) => {
  const changed = PERSISTED.some((k) => state[k] !== prev[k]);
  if (!changed) return;
  window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    for (const key of PERSISTED) {
      const result = save(key, state[key]);
      if (result === "quota") {
        useApp.setState({
          storageWarning:
            "O armazenamento do navegador encheu. Baixe um backup no Diário de Obra e apague análises antigas.",
        });
        return;
      }
    }
  }, 400);
});

/** Backup manual do acervo local (.json) — a rede de segurança sem backend. */
export function exportBackup(): void {
  const data = snapshot([...PERSISTED]);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `obra360-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Restaura um backup previamente baixado. */
export async function importBackup(file: File): Promise<void> {
  const text = await file.text();
  const data = JSON.parse(text) as Record<string, unknown>;
  if (data._app !== "obra360") throw new Error("Arquivo não é um backup do Obra360");
  const patch: Record<string, unknown> = {};
  for (const key of PERSISTED) {
    if (Array.isArray(data[key]) || typeof data[key] === "string") patch[key] = data[key];
  }
  useApp.setState(patch as Partial<AppState>);
}
