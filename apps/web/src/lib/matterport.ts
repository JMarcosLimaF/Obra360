/**
 * Integração com o Matterport SDK for Embeds.
 *
 * O SDK conecta ao iframe do showcase (mesmo modelo público) e expõe:
 *  - Pointer.intersection → coordenada 3D sob o cursor (marcação por coordenada)
 *  - Tag.add / Mattertag.add → pins persistentes no espaço do modelo
 *  - Renderer.takeScreenShot → imagem da vista atual (entrada da análise por IA)
 *  - Camera.pose → posição/rotação da câmera
 *
 * Requer uma applicationKey (gratuita: my.matterport.com → Settings → Developer Tools).
 */
import type { MpPoint } from "../types";

declare global {
  interface Window {
    MP_SDK?: {
      connect: (iframe: HTMLIFrameElement, sdkKey?: string, version?: string) => Promise<MpSdk>;
    };
  }
}

/* Tipagem mínima do que usamos — o SDK oficial não distribui types por npm p/ embeds */
export interface MpIntersection {
  position: MpPoint;
  normal: MpPoint;
  floorIndex?: number;
}
export interface MpPose {
  position: MpPoint;
  rotation: { x: number; y: number };
  sweep?: string;
}
export interface MpSdk {
  Pointer: {
    intersection: { subscribe: (cb: (i: MpIntersection) => void) => { cancel: () => void } };
  };
  Camera: {
    pose: { subscribe: (cb: (p: MpPose) => void) => { cancel: () => void } };
    getPose: () => Promise<MpPose>;
  };
  Renderer: {
    takeScreenShot: (
      resolution?: { width: number; height: number },
      visibility?: { mattertags?: boolean; sweeps?: boolean },
    ) => Promise<string>;
    /** Raycast tela→mundo contra a malha do modelo (mesmo snapping da medição
     *  do Matterport). Coordenadas em px CSS relativas ao canvas do showcase. */
    getWorldPositionData?: (screenPosition: { x: number; y: number }) => Promise<{
      position: MpPoint;
      floorInfo?: { id: string; sequence: number };
      floor?: number;
    }>;
  };
  /** projeção mundo→tela: base da camada de polígonos sobre o tour */
  Conversion?: {
    worldToScreen: (p: MpPoint, pose: MpPose, size: { w: number; h: number }) => MpPoint;
  };
  /** navegação entre pontos de captura — leva a câmera de volta a uma vista */
  Sweep?: {
    moveTo: (sweepId: string, options?: {
      rotation?: { x: number; y: number };
      transition?: string;
      transitionTime?: number;
    }) => Promise<string>;
    Transition?: Record<string, string>;
  };
  Tag?: {
    add: (...tags: TagDescriptor[]) => Promise<string[]>;
    dock?: (id: string) => Promise<void>;
  };
  Mattertag?: {
    add: (tags: MattertagDescriptor[]) => Promise<string[]>;
    navigateToTag?: (id: string, transition: string) => Promise<string>;
  };
  disconnect?: () => void;
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("raycast expirou")), ms)),
  ]);
}

/** Ponto 3D sob uma coordenada de tela (snapping na malha do modelo).
 *  Retorna null se o modelo ainda não está pronto ou o raio não acerta nada. */
export async function worldAt(
  sdk: MpSdk, x: number, y: number,
): Promise<MpPoint | null> {
  if (!sdk.Renderer?.getWorldPositionData) return null;
  try {
    const r = await withDeadline(sdk.Renderer.getWorldPositionData({ x, y }), 3000);
    return r?.position ?? null;
  } catch {
    return null;
  }
}

/** Normal da superfície sob a coordenada de tela, por 3 amostras vizinhas.
 *  Orientada para a câmera. Usa (0,1,0) como fallback quando indeterminada. */
export async function surfaceNormalAt(
  sdk: MpSdk, x: number, y: number, cameraPos?: MpPoint, spread = 16,
): Promise<MpPoint> {
  const UP: MpPoint = { x: 0, y: 1, z: 0 };
  const [a, b, c] = await Promise.all([
    worldAt(sdk, x, y),
    worldAt(sdk, x + spread, y),
    worldAt(sdk, x, y + spread),
  ]);
  if (!a || !b || !c) return UP;
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const n = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
  if (!Number.isFinite(len) || len < 1e-6) return UP;
  let out = { x: n.x / len, y: n.y / len, z: n.z / len };
  if (cameraPos) {
    const toCam = { x: cameraPos.x - a.x, y: cameraPos.y - a.y, z: cameraPos.z - a.z };
    if (out.x * toCam.x + out.y * toCam.y + out.z * toCam.z < 0) {
      out = { x: -out.x, y: -out.y, z: -out.z };
    }
  }
  return out;
}

/** Voa a câmera até um tag existente (assinatura legada com fallback). */
export async function flyToTag(sdk: MpSdk, tagId: string): Promise<boolean> {
  try {
    if (sdk.Mattertag?.navigateToTag) {
      await sdk.Mattertag.navigateToTag(tagId, "transition.fly");
      return true;
    }
    if (sdk.Tag?.dock) {
      await sdk.Tag.dock(tagId);
      return true;
    }
  } catch (err) {
    console.warn("flyToTag falhou:", err);
  }
  return false;
}

/** Leva a câmera de volta ao ponto (sweep + rotação) de uma observação. */
export async function flyToPose(
  sdk: MpSdk, pose: { sweep: string; rotation: { x: number; y: number } },
): Promise<boolean> {
  if (!sdk.Sweep?.moveTo || !pose.sweep) return false;
  try {
    await sdk.Sweep.moveTo(pose.sweep, {
      rotation: pose.rotation,
      transition: sdk.Sweep.Transition?.FLY ?? "transition.fly",
    });
    return true;
  } catch (err) {
    console.warn("flyToPose falhou:", err);
    return false;
  }
}

export function polygonCentroid(pts: MpPoint[]): MpPoint {
  const n = pts.length || 1;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
    z: pts.reduce((s, p) => s + p.z, 0) / n,
  };
}

/** Área do polígono 3D (m²) pela normal de Newell — |n|/2. */
export function polygonAreaM2(pts: MpPoint[]): number {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
}

// ---- álgebra vetorial mínima para o retângulo ancorado ----
export const vAdd = (a: MpPoint, b: MpPoint): MpPoint => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vScale = (a: MpPoint, s: number): MpPoint => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const vCross = (a: MpPoint, b: MpPoint): MpPoint => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const vNorm = (a: MpPoint): MpPoint => {
  const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Base ortonormal (u,v) do plano definido pela normal da superfície tocada.
 *  Piso/teto: u alinhado ao eixo Z do mundo; parede: u horizontal, v vertical. */
export function planeBasis(normalIn: MpPoint): { u: MpPoint; v: MpPoint } {
  const n = vNorm(normalIn.x || normalIn.y || normalIn.z ? normalIn : { x: 0, y: 1, z: 0 });
  const helper: MpPoint = Math.abs(n.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = vNorm(vCross(helper, n));
  const v = vNorm(vCross(n, u));
  return { u, v };
}

/** Eixos do retângulo no plano, girados por theta (graus). */
export function rectAxes(normal: MpPoint, thetaDeg: number): { u: MpPoint; v: MpPoint } {
  const { u, v } = planeBasis(normal);
  const t = (thetaDeg * Math.PI) / 180;
  return {
    u: vAdd(vScale(u, Math.cos(t)), vScale(v, Math.sin(t))),
    v: vAdd(vScale(u, -Math.sin(t)), vScale(v, Math.cos(t))),
  };
}

/** 4 cantos do retângulo (ordem não auto-intersectante). */
export function rectCorners(
  center: MpPoint, normal: MpPoint, thetaDeg: number, w: number, h: number,
): MpPoint[] {
  const { u, v } = rectAxes(normal, thetaDeg);
  const hu = vScale(u, w / 2);
  const hv = vScale(v, h / 2);
  return [
    vAdd(vAdd(center, vScale(hu, -1)), vScale(hv, -1)),
    vAdd(vAdd(center, hu), vScale(hv, -1)),
    vAdd(vAdd(center, hu), hv),
    vAdd(vAdd(center, vScale(hu, -1)), hv),
  ];
}

/** Vetor "para frente" da câmera a partir da pose (yaw/pitch em graus). */
export function poseForward(pose: MpPose): MpPoint {
  const DEG = Math.PI / 180;
  const rx = pose.rotation.x * DEG;
  const ry = pose.rotation.y * DEG;
  return {
    x: -Math.sin(ry) * Math.cos(rx),
    y: Math.sin(rx),
    z: -Math.cos(ry) * Math.cos(rx),
  };
}

export interface TagDescriptor {
  label: string;
  description?: string;
  anchorPosition: MpPoint;
  stemVector?: MpPoint;
  color?: { r: number; g: number; b: number };
}
type MattertagDescriptor = TagDescriptor & { stemVector: MpPoint };

const SDK_SCRIPT = "https://static.matterport.com/showcase-sdk/latest.js";
let scriptPromise: Promise<void> | null = null;

function loadSdkScript(): Promise<void> {
  if (window.MP_SDK) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SDK_SCRIPT;
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error("Falha ao carregar o script do Matterport SDK")); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export function embedUrl(modelId: string, sdkKey?: string): string {
  const base = `https://my.matterport.com/show?m=${modelId}&play=1&lang=pt&qs=1`;
  return sdkKey ? `${base}&applicationKey=${encodeURIComponent(sdkKey)}` : base;
}

/** Miniatura pública do modelo (a mesma imagem de capa do showcase). */
export const thumbUrl = (modelId: string) => `https://my.matterport.com/api/v1/player/models/${modelId}/thumb`;

/** Conecta o SDK ao iframe do showcase.
 *  A assinatura legada connect(iframe, key, '') é a que o serviço aceita hoje
 *  (a nova, que lê applicationKey da URL, retorna "invalid key"); mantemos a
 *  nova como fallback caso o comportamento mude. */
export async function connectSdk(iframe: HTMLIFrameElement, sdkKey: string): Promise<MpSdk> {
  await loadSdkScript();
  if (!window.MP_SDK) throw new Error("MP_SDK indisponível após carregar o script");
  try {
    return await withTimeout(window.MP_SDK.connect(iframe, sdkKey, ""), 15_000);
  } catch (legacyErr) {
    try {
      return await withTimeout(window.MP_SDK.connect(iframe), 15_000);
    } catch {
      throw legacyErr instanceof Error ? legacyErr : new Error(String(legacyErr));
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout na conexão do SDK")), ms)),
  ]);
}

const AMBER = { r: 0.96, g: 0.62, b: 0.04 };

/** Cria um tag no modelo (API nova com fallback para a legada). */
export async function addTag(
  sdk: MpSdk,
  opts: { label: string; description?: string; position: MpPoint; color?: { r: number; g: number; b: number } },
): Promise<string | null> {
  const desc: TagDescriptor = {
    label: opts.label,
    description: opts.description,
    anchorPosition: opts.position,
    stemVector: { x: 0, y: 0.35, z: 0 },
    color: opts.color ?? AMBER,
  };
  try {
    if (sdk.Tag) {
      const ids = await sdk.Tag.add(desc);
      return ids[0] ?? null;
    }
    if (sdk.Mattertag) {
      const ids = await sdk.Mattertag.add([{ ...desc, stemVector: desc.stemVector! }]);
      return ids[0] ?? null;
    }
  } catch (err) {
    console.warn("Falha ao criar tag no Matterport:", err);
  }
  return null;
}
