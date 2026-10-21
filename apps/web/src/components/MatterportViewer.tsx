import { useCallback, useEffect, useRef, useState } from "react";
import { downscaleDataUrl, isBlankFrame, markPoint } from "../lib/image";
import { useApp } from "../store";
import {
  addTag, connectSdk, embedUrl, flyToPose, flyToTag, polygonAreaM2, polygonCentroid, poseForward,
  rectAxes, rectCorners, surfaceNormalAt, vAdd, vScale, worldAt,
  type MpPose, type MpSdk,
} from "../lib/matterport";
import type { MpPoint } from "../types";
import { analyzeView } from "../lib/ai";
import { IconAlert, IconCheck, IconClose, IconCrosshair, IconGear, IconPolygon, IconSpark } from "./ui";
import RichText from "./RichText";

/** SDK ativo da sessão — consumido também pelo IssuePanel ao criar pendências. */
export const mpState: { sdk: MpSdk | null } = { sdk: null };

type MarkMode = null | "ponto" | "rect" | "poly";

interface RectDraft {
  center: MpPoint;
  normal: MpPoint;
  theta: number; // graus
  w: number;     // metros
  h: number;     // metros
}

type DragKind = "+u" | "-u" | "+v" | "-v" | "move";

/* Vidro escuro sobre o tour (DESIGN.md) e as ferramentas dentro dele —
   44px de alvo no toque, compactas no desktop */
const GLASS = "bg-[rgb(8_20_32/0.62)] text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl";
const TOOL = "flex h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-2 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-200 disabled:pointer-events-none disabled:opacity-40 sm:h-9 sm:min-w-9 sm:px-3";
const TOOL_IDLE = "text-white/80 hover:bg-white/10 hover:text-white";
const TOOL_ACTIVE = "bg-brand text-white shadow-[0_6px_16px_-6px_rgb(0_155_255/0.75)]";
const BAR_BTN = "flex h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[12px] font-semibold transition-[background-color,color,filter] duration-200 disabled:pointer-events-none disabled:opacity-40 sm:h-8";
const BAR_LIGHT = "bg-white text-ink hover:bg-white/90";
const BAR_AMBER = "bg-[#F59E0B] text-ink hover:brightness-110";
const BAR_GHOST = "bg-white/[0.06] text-white/80 ring-1 ring-inset ring-white/10 hover:bg-white/[0.12] hover:text-white";

interface ViewerProps {
  modelId: string;
  projectId: string;
  /** avisa o pai quando o SDK conecta/desconecta (usado pela visita guiada) */
  onSdkChange?: (sdk: MpSdk | null) => void;
  /** esconde o botão de análise quando o pai já oferece um fluxo próprio */
  hideAnalysis?: boolean;
}

export default function MatterportViewer({ modelId, projectId, onSdkChange, hideAnalysis }: ViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastPose = useRef<MpPose | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const rectRef = useRef<RectDraft | null>(null);

  const mpSdkKey = useApp((s) => s.mpSdkKey);
  const setPendingAnchor = useApp((s) => s.setPendingAnchor);
  const setPendingPolygon = useApp((s) => s.setPendingPolygon);
  const addAnalysis = useApp((s) => s.addAnalysis);
  const issues = useApp((s) => s.issues);
  const setIssueTagId = useApp((s) => s.setIssueTagId);
  const flyToIssueId = useApp((s) => s.flyToIssueId);
  const requestFlyTo = useApp((s) => s.requestFlyTo);
  const flyToPoseReq = useApp((s) => s.flyToPose);
  const requestFlyToPose = useApp((s) => s.requestFlyToPose);
  const setPendingShot = useApp((s) => s.setPendingShot);
  const userName = useApp((s) => s.user);

  const [connected, setConnected] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [fallbackNoKey, setFallbackNoKey] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // marcação de ocorrências
  const [markMode, setMarkMode] = useState<MarkMode>(null);
  const [draft, setDraft] = useState<MpPoint[]>([]);
  const [rectDraft, setRectDraftState] = useState<RectDraft | null>(null);
  const setRectDraft = (r: RectDraft | null) => { rectRef.current = r; setRectDraftState(r); };

  /* Mira própria: fica sobre o tour e captura o ponteiro, então arrastá-la
     nunca move a câmera. A posição 3D vem do raycast do SDK. */
  const reticleRef = useRef({ x: 0, y: 0 });
  const [reticle, setReticleState] = useState<{ x: number; y: number } | null>(null);
  const setReticle = (p: { x: number; y: number } | null) => {
    if (p) reticleRef.current = p;
    setReticleState(p);
  };
  const [aim, setAim] = useState<MpPoint | null>(null);
  const [aiming, setAiming] = useState(false);
  const sampleSeq = useRef(0);
  const sampleTimer = useRef<number | null>(null);

  const [pose, setPose] = useState<MpPose | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // análise por IA
  const [shot, setShot] = useState<string | null>(null);
  const [question, setQuestion] = useState("Analise o estágio da obra e aponte riscos visíveis nesta vista.");
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<{ text: string; simulated: boolean } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const s = { w: el.clientWidth, h: el.clientHeight };
      sizeRef.current = s;
      setSize(s);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setFallbackNoKey(false), [mpSdkKey, modelId]);

  // ---- amostragem do ponto 3D sob a mira ----
  const sampleNow = useCallback(async () => {
    const sdk = mpState.sdk;
    if (!sdk) return;
    const { x, y } = reticleRef.current;
    const seq = ++sampleSeq.current;
    setAiming(true);
    const pos = await worldAt(sdk, x, y);
    if (seq === sampleSeq.current) {
      setAim(pos);
      setAiming(false);
    }
  }, []);

  const scheduleSample = useCallback((delay = 120) => {
    if (sampleTimer.current) window.clearTimeout(sampleTimer.current);
    sampleTimer.current = window.setTimeout(() => { void sampleNow(); }, delay);
  }, [sampleNow]);

  // reamostra quando a câmera se move (a mira fica parada na tela)
  useEffect(() => {
    if (markMode && !rectDraft) scheduleSample(200);
  }, [pose, markMode, rectDraft, scheduleSample]);

  // conexão do SDK
  useEffect(() => {
    if (!mpSdkKey || fallbackNoKey || !iframeRef.current) return;
    let cancelled = false;
    const subs: { cancel: () => void }[] = [];
    const iframe = iframeRef.current;

    const connectWithRetry = async () => {
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 10 && !cancelled; attempt++) {
        try {
          const sdk = await connectSdk(iframe, mpSdkKey);
          if (cancelled) return;
          mpState.sdk = sdk;
          if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__mpSdk = sdk;
          setConnected(true);
          setSdkError(null);
          onSdkChange?.(sdk);
          subs.push(sdk.Camera.pose.subscribe((p) => {
            lastPose.current = p;
            setPose(p);
          }));
          for (const iss of useApp.getState().issues) {
            if (iss.mp && !iss.tagId && iss.projectId === projectId) {
              const tagId = await addTag(sdk, {
                label: iss.title,
                description: tagDescription(iss.discipline, iss.assignee, iss.dueDate, iss.areaM2),
                position: iss.mp,
              });
              if (tagId) useApp.getState().setIssueTagId(iss.id, tagId);
            }
          }
          return;
        } catch (err) {
          lastErr = err;
          console.warn(`MP_SDK connect (tentativa ${attempt + 1}):`, err);
          await new Promise((r) => setTimeout(r, 2500));
        }
      }
      if (!cancelled) {
        setSdkError(lastErr instanceof Error ? lastErr.message : String(lastErr ?? "falha na conexão"));
        setConnected(false);
        setFallbackNoKey(true);
      }
    };
    connectWithRetry();

    return () => {
      cancelled = true;
      subs.forEach((s) => s.cancel());
      mpState.sdk?.disconnect?.();
      mpState.sdk = null;
      setConnected(false);
      setPose(null);
      onSdkChange?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpSdkKey, modelId, fallbackNoKey]);

  // tags para pendências criadas durante a sessão
  useEffect(() => {
    const sdk = mpState.sdk;
    if (!sdk) return;
    for (const iss of issues) {
      if (iss.mp && !iss.tagId && iss.projectId === projectId) {
        addTag(sdk, {
          label: iss.title,
          description: tagDescription(iss.discipline, iss.assignee, iss.dueDate, iss.areaM2),
          position: iss.mp,
        }).then((tagId) => { if (tagId) setIssueTagId(iss.id, tagId); });
      }
    }
  }, [issues, projectId, setIssueTagId]);

  // voo até a pendência pedida por qualquer módulo (lista, planta, RDO)
  useEffect(() => {
    const sdk = mpState.sdk;
    if (!flyToIssueId || !sdk || !connected) return;
    const iss = issues.find((i) => i.id === flyToIssueId);
    requestFlyTo(null);
    if (iss?.tagId) flyToTag(sdk, iss.tagId);
    else if (iss?.pose) flyToPose(sdk, iss.pose);
  }, [flyToIssueId, connected, issues, requestFlyTo]);

  // voo até uma vista salva (pino de planta, foto de visita)
  useEffect(() => {
    const sdk = mpState.sdk;
    if (!flyToPoseReq || !sdk || !connected) return;
    requestFlyToPose(null);
    flyToPose(sdk, flyToPoseReq);
  }, [flyToPoseReq, connected, requestFlyToPose]);

  // ---- entrada/saída dos modos de marcação ----
  const startMode = (mode: Exclude<MarkMode, null>) => {
    setDraft([]);
    setRectDraft(null);
    setMarkMode(mode);
    const s = sizeRef.current;
    setReticle({ x: Math.round(s.w / 2), y: Math.round(s.h / 2) });
    setAim(null);
    scheduleSample(60);
  };
  const resetMark = () => {
    setMarkMode(null);
    setDraft([]);
    setRectDraft(null);
    setReticle(null);
    setAim(null);
  };

  /**
   * Congela a vista no instante da marcação.
   *
   * Pedir a foto depois abre uma janela em que a câmera pode girar, e a
   * evidência deixa de mostrar o ponto que a peça ancora. Aqui a imagem, a
   * coordenada e a pose saem do mesmo instante — e a mira é queimada no pixel,
   * para o documento se explicar sozinho fora do sistema.
   */
  const congelarVista = async () => {
    const sdk = mpState.sdk;
    const sz = sizeRef.current;
    if (!sdk || !sz.w || !sz.h) return;
    const { x, y } = reticleRef.current;
    try {
      const shot = await sdk.Renderer.takeScreenShot({ width: 1280, height: 720 });
      if (await isBlankFrame(shot)) return;
      const comMira = await markPoint(shot, x / sz.w, y / sz.h);
      const small = await downscaleDataUrl(comMira, 1100, 0.85);
      const ps = lastPose.current;
      setPendingShot({
        id: `ev-img-${Date.now().toString(36)}`,
        kind: "abertura",
        imageDataUrl: small,
        pose: ps?.sweep ? { sweep: ps.sweep, rotation: ps.rotation } : undefined,
        author: userName ?? "",
        role: "fiscalizacao",
        note: "",
        createdAt: new Date().toISOString(),
      });
    } catch {
      /* sem foto automática: o formulário ainda permite capturar ou enviar */
    }
  };

  const confirmPoint = () => {
    if (!aim) return;
    void congelarVista();
    setPendingAnchor(aim);
    resetMark();
  };

  const anchorRect = async () => {
    const sdk = mpState.sdk;
    if (!sdk || !aim) return;
    const { x, y } = reticleRef.current;
    const normal = await surfaceNormalAt(sdk, x, y, lastPose.current?.position);
    setRectDraft({ center: aim, normal, theta: 0, w: 1, h: 1 });
  };

  const confirmRect = () => {
    const d = rectRef.current;
    if (!d) return;
    void congelarVista();
    setPendingPolygon(rectCorners(d.center, d.normal, d.theta, d.w, d.h));
    setPendingAnchor(d.center);
    resetMark();
  };

  const addDraftVertex = () => {
    if (aim) setDraft((v) => [...v, aim]);
  };

  const finishPoly = () => {
    if (draft.length < 3) return;
    void congelarVista();
    setPendingPolygon(draft);
    setPendingAnchor(polygonCentroid(draft));
    resetMark();
  };

  /* Arraste genérico: o gesto começa no NOSSO elemento (a câmera nunca se move)
     e o pointer capture impede que o iframe do tour roube os eventos seguintes;
     os listeners ficam na janela porque os eventos capturados sobem até ela. */
  const beginDrag = (
    e: React.PointerEvent<Element>,
    onMove: (ev: PointerEvent) => void,
    onEnd?: () => void,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ponteiro já liberado */ }
    const move = (ev: PointerEvent) => { ev.preventDefault(); onMove(ev); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onEnd?.();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // ---- arraste da mira ----
  const startReticleDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    beginDrag(
      e,
      (ev) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = Math.max(8, Math.min(rect.width - 8, ev.clientX - rect.left));
        const y = Math.max(8, Math.min(rect.height - 8, ev.clientY - rect.top));
        setReticle({ x, y });
        scheduleSample(90);
      },
      () => { void sampleNow(); },
    );
  };

  const takeShot = async () => {
    const sdk = mpState.sdk;
    if (!sdk) return;
    setAiResult(null);
    setAiError(null);
    try {
      const dataUrl = await sdk.Renderer.takeScreenShot(
        { width: 1280, height: 720 },
        { mattertags: false, sweeps: false },
      );
      setShot(dataUrl);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Falha ao capturar a vista");
    }
  };

  const runAnalysis = async () => {
    if (!shot) return;
    setAnalyzing(true);
    setAiError(null);
    try {
      const result = await analyzeView(shot, question, projectId);
      setAiResult(result);
      addAnalysis({
        projectId, question, result: result.text, imageDataUrl: shot,
        cameraPos: lastPose.current?.position, simulated: result.simulated,
      });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Falha na análise");
    } finally {
      setAnalyzing(false);
    }
  };

  // ------- projeção mundo→tela -------
  const w2s = (p: MpPoint): { x: number; y: number } | null => {
    const s = mpState.sdk;
    const ps = lastPose.current;
    const sz = sizeRef.current;
    if (!s?.Conversion || !ps || !sz.w) return null;
    const fwd = poseForward(ps);
    const dx = p.x - ps.position.x, dy = p.y - ps.position.y, dz = p.z - ps.position.z;
    if (dx * fwd.x + dy * fwd.y + dz * fwd.z <= 0.05) return null;
    const out = s.Conversion.worldToScreen(p, ps, sz);
    if (!Number.isFinite(out.x) || !Number.isFinite(out.y)) return null;
    return { x: out.x, y: out.y };
  };
  const project = (p: MpPoint) => (pose && size.w ? w2s(p) : null);

  /* Arraste dos handles do retângulo: px → metros projetando os eixos do plano */
  const applyDrag = (kind: DragKind, dxPx: number, dyPx: number) => {
    const d = rectRef.current;
    if (!d) return;
    const axes = rectAxes(d.normal, d.theta);
    const EPS = 0.1;
    const axisScreen = (origin: MpPoint, axis: MpPoint) => {
      const a = w2s(origin);
      const b = w2s(vAdd(origin, vScale(axis, EPS)));
      if (!a || !b) return null;
      return { x: (b.x - a.x) / EPS, y: (b.y - a.y) / EPS };
    };

    if (kind === "move") {
      const mU = axisScreen(d.center, axes.u);
      const mV = axisScreen(d.center, axes.v);
      if (!mU || !mV) return;
      const det = mU.x * mV.y - mU.y * mV.x;
      if (Math.abs(det) < 1e-6) return;
      const du = (dxPx * mV.y - dyPx * mV.x) / det;
      const dv = (-dxPx * mU.y + dyPx * mU.x) / det;
      setRectDraft({ ...d, center: vAdd(d.center, vAdd(vScale(axes.u, du), vScale(axes.v, dv))) });
      return;
    }

    const along = kind === "+u" || kind === "-u" ? axes.u : axes.v;
    const sign = kind.startsWith("+") ? 1 : -1;
    const dim = kind.endsWith("u") ? d.w : d.h;
    const edge = vAdd(d.center, vScale(along, (sign * dim) / 2));
    const dir = axisScreen(edge, vScale(along, sign));
    if (!dir) return;
    const len2 = dir.x * dir.x + dir.y * dir.y;
    if (len2 < 1e-6) return;
    const dM = (dxPx * dir.x + dyPx * dir.y) / len2;
    const next = Math.min(30, Math.max(0.2, dim + dM));
    const shift = vScale(along, (sign * (next - dim)) / 2);
    setRectDraft({
      ...d,
      w: kind.endsWith("u") ? next : d.w,
      h: kind.endsWith("v") ? next : d.h,
      center: vAdd(d.center, shift),
    });
  };

  const startDrag = (kind: DragKind) => (e: React.PointerEvent<HTMLButtonElement>) => {
    let last = { x: e.clientX, y: e.clientY };
    beginDrag(e, (ev) => {
      applyDrag(kind, ev.clientX - last.x, ev.clientY - last.y);
      last = { x: ev.clientX, y: ev.clientY };
    });
  };

  const clampDim = (v: number) => Math.min(30, Math.max(0.2, Math.round(v * 100) / 100));
  const setDim = (key: "w" | "h", value: number) => {
    const d = rectRef.current;
    if (!d || !Number.isFinite(value)) return;
    setRectDraft({ ...d, [key]: clampDim(value) });
  };
  /** Passo relativo lido do estado atual — cliques rápidos acumulam. */
  const stepDim = (key: "w" | "h", delta: number) => {
    const d = rectRef.current;
    if (!d) return;
    setRectDraft({ ...d, [key]: clampDim(d[key] + delta) });
  };
  const rotate = (deg: number) => {
    const d = rectRef.current;
    if (d) setRectDraft({ ...d, theta: (d.theta + deg + 360) % 360 });
  };

  const polygonIssues = issues.filter(
    (i) => i.projectId === projectId && i.mpPolygon && i.mpPolygon.length >= 3 && i.status !== "resolvido",
  );
  const projectPolygon = (pts: MpPoint[]): string | null => {
    const out: string[] = [];
    for (const p of pts) {
      const s = project(p);
      if (!s) return null;
      out.push(`${s.x},${s.y}`);
    }
    return out.join(" ");
  };

  const rectCornersProj = rectDraft
    ? rectCorners(rectDraft.center, rectDraft.normal, rectDraft.theta, rectDraft.w, rectDraft.h).map(project)
    : null;
  const rectVisible = !!rectCornersProj && rectCornersProj.every(Boolean);
  const rectHandles: { kind: DragKind; label: string; p: { x: number; y: number } }[] = [];
  if (rectDraft && rectVisible) {
    const axes = rectAxes(rectDraft.normal, rectDraft.theta);
    const defs: [DragKind, MpPoint, string][] = [
      ["move", rectDraft.center, "Mover área"],
      ["+u", vAdd(rectDraft.center, vScale(axes.u, rectDraft.w / 2)), "Ajustar largura"],
      ["-u", vAdd(rectDraft.center, vScale(axes.u, -rectDraft.w / 2)), "Ajustar largura"],
      ["+v", vAdd(rectDraft.center, vScale(axes.v, rectDraft.h / 2)), "Ajustar altura"],
      ["-v", vAdd(rectDraft.center, vScale(axes.v, -rectDraft.h / 2)), "Ajustar altura"],
    ];
    for (const [kind, world, label] of defs) {
      const p = project(world);
      if (p) rectHandles.push({ kind, label, p });
    }
  }

  const draftProjected = draft.map(project);
  const showReticle = !!reticle && !!markMode && !rectDraft;

  return (
    <div ref={containerRef} className="relative h-full w-full bg-navy-950">
      <iframe
        key={`${modelId}:${fallbackNoKey ? "" : mpSdkKey}`}
        ref={iframeRef}
        title="Tour Matterport"
        src={embedUrl(modelId, fallbackNoKey ? undefined : mpSdkKey || undefined)}
        className="h-full w-full border-0"
        allow="fullscreen; web-share; xr-spatial-tracking"
        allowFullScreen
      />

      {/* camada de áreas projetadas sobre o tour */}
      {connected && pose && size.w > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 z-10"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
        >
          {polygonIssues.map((iss) => {
            const pts = projectPolygon(iss.mpPolygon!);
            if (!pts) return null;
            const first = pts.split(" ")[0].split(",").map(Number);
            return (
              <g key={iss.id}>
                <polygon points={pts} fill="rgba(0,155,255,0.16)" stroke="#009BFF" strokeWidth="2" strokeLinejoin="round" />
                <text x={first[0] + 8} y={first[1] - 8} fontSize="11" fontWeight="600" fill="#FFFFFF" stroke="rgba(8,20,32,0.85)" strokeWidth="3" paintOrder="stroke" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
                  {iss.title}{iss.areaM2 ? ` · ~${iss.areaM2.toFixed(1)} m²` : ""}
                </text>
              </g>
            );
          })}

          {rectDraft && rectVisible && rectCornersProj && (
            <g>
              <polygon
                points={rectCornersProj.map((s) => `${s!.x},${s!.y}`).join(" ")}
                fill="rgba(245,158,11,0.16)" stroke="#F59E0B" strokeWidth="2" strokeLinejoin="round"
              />
              <text
                x={(rectCornersProj[1]!.x + rectCornersProj[2]!.x) / 2 + 10}
                y={(rectCornersProj[1]!.y + rectCornersProj[2]!.y) / 2}
                fontSize="11" fontWeight="700" fill="#FFFFFF" stroke="rgba(8,20,32,0.85)" strokeWidth="3" paintOrder="stroke"
                style={{ fontFamily: "JetBrains Mono, monospace" }}
              >
                {rectDraft.h.toFixed(2)} m
              </text>
              <text
                x={(rectCornersProj[2]!.x + rectCornersProj[3]!.x) / 2}
                y={(rectCornersProj[2]!.y + rectCornersProj[3]!.y) / 2 + 18}
                fontSize="11" fontWeight="700" fill="#FFFFFF" stroke="rgba(8,20,32,0.85)" strokeWidth="3" paintOrder="stroke" textAnchor="middle"
                style={{ fontFamily: "JetBrains Mono, monospace" }}
              >
                {rectDraft.w.toFixed(2)} m
              </text>
            </g>
          )}

          {markMode === "poly" && draftProjected.length > 0 && (
            <g>
              {draftProjected.length > 1 && (
                <polyline
                  points={draftProjected.filter(Boolean).map((s) => `${s!.x},${s!.y}`).join(" ")}
                  fill={draftProjected.length > 2 ? "rgba(245,158,11,0.14)" : "none"}
                  stroke="#F59E0B" strokeWidth="2" strokeLinejoin="round"
                />
              )}
              {draftProjected.length > 2 && draftProjected[0] && draftProjected.at(-1) && (
                <line
                  x1={draftProjected.at(-1)!.x} y1={draftProjected.at(-1)!.y}
                  x2={draftProjected[0].x} y2={draftProjected[0].y}
                  stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="5 4"
                />
              )}
              {draftProjected.map((s, i) =>
                s ? (
                  <g key={i}>
                    <circle cx={s.x} cy={s.y} r="6" fill="#F59E0B" stroke="#FFFFFF" strokeWidth="2" />
                    <text x={s.x + 9} y={s.y - 7} fontSize="10" fontWeight="700" fill="#FFFFFF" stroke="rgba(8,20,32,0.85)" strokeWidth="3" paintOrder="stroke" style={{ fontFamily: "JetBrains Mono, monospace" }}>
                      {i + 1}
                    </text>
                  </g>
                ) : null,
              )}
            </g>
          )}
        </svg>
      )}

      {/* MIRA — captura o ponteiro, então arrastar não move a câmera */}
      {showReticle && reticle && (
        <div
          onPointerDown={startReticleDrag}
          role="application"
          aria-label="Mira de marcação — arraste para posicionar"
          className="absolute z-20 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none place-items-center"
          style={{ left: reticle.x, top: reticle.y }}
        >
          <svg viewBox="0 0 56 56" className="h-14 w-14">
            <circle cx="28" cy="28" r="15" fill="rgba(8,20,32,0.28)" stroke="#FFFFFF" strokeWidth="2" />
            <circle cx="28" cy="28" r="15" fill="none" stroke={aim ? "#F59E0B" : "#F87171"} strokeWidth="2" strokeDasharray="4 4" />
            <line x1="28" y1="4" x2="28" y2="17" stroke="#FFFFFF" strokeWidth="2" />
            <line x1="28" y1="39" x2="28" y2="52" stroke="#FFFFFF" strokeWidth="2" />
            <line x1="4" y1="28" x2="17" y2="28" stroke="#FFFFFF" strokeWidth="2" />
            <line x1="39" y1="28" x2="52" y2="28" stroke="#FFFFFF" strokeWidth="2" />
            <circle cx="28" cy="28" r="3" fill={aim ? "#F59E0B" : "#F87171"} />
          </svg>
          {/* leitura 3D colada na mira */}
          <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[rgb(8_20_32/0.72)] px-2 py-1 font-mono text-[10.5px] text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md">
            {aiming && !aim
              ? "lendo superfície…"
              : aim
                ? `X ${aim.x.toFixed(2)}  Y ${aim.y.toFixed(2)}  Z ${aim.z.toFixed(2)}`
                : "sem superfície aqui"}
          </span>
        </div>
      )}

      {/* handles do retângulo */}
      {rectDraft && rectVisible && rectHandles.map(({ kind, label, p }) => (
        <button
          key={kind}
          aria-label={label}
          onPointerDown={startDrag(kind)}
          className="absolute z-20 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full"
          style={{ left: p.x, top: p.y, cursor: kind === "move" ? "move" : "grab" }}
        >
          <span className={`block rounded-full border-2 border-white shadow-md ${kind === "move" ? "h-5 w-5 bg-[#F59E0B]" : "h-4 w-4 bg-white"}`} />
        </button>
      ))}

      {/* barra de ações do viewer */}
      <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex items-center justify-start gap-2 px-3 md:justify-center">
        <div className={`pointer-events-auto flex animate-pop items-center gap-1 rounded-2xl p-1 ${GLASS}`}>
          <button
            onClick={() => (markMode === "ponto" ? resetMark() : startMode("ponto"))}
            disabled={!connected}
            title={connected ? "Marcar ocorrência pontual (coordenada 3D)" : "O tour precisa estar conectado"}
            className={`${TOOL} ${markMode === "ponto" ? TOOL_ACTIVE : TOOL_IDLE}`}
          >
            <IconCrosshair className="h-[15px] w-[15px]" />
            <span className="hidden sm:inline">Marcar local</span>
          </button>
          <button
            onClick={() => (markMode === "rect" || markMode === "poly" ? resetMark() : startMode("rect"))}
            disabled={!connected}
            title={connected ? "Delimitar uma área na superfície" : "O tour precisa estar conectado"}
            className={`${TOOL} ${markMode === "rect" || markMode === "poly" ? TOOL_ACTIVE : TOOL_IDLE}`}
          >
            <IconPolygon className="h-[15px] w-[15px]" />
            <span className="hidden sm:inline">Marcar área</span>
          </button>
          {!hideAnalysis && (
            <button
              onClick={takeShot}
              disabled={!connected}
              title={connected ? "Analisar a vista atual com IA" : "O tour precisa estar conectado"}
              className={`${TOOL} ${TOOL_IDLE}`}
            >
              <IconSpark className="h-[15px] w-[15px]" />
              <span className="hidden sm:inline">Analisar com IA</span>
            </button>
          )}
          <span aria-hidden className="mx-0.5 h-5 w-px bg-white/10" />
          <button
            onClick={() => setShowSettings(true)}
            aria-label="Configurações do tour"
            title="Configurar a chave do tour"
            className={`${TOOL} ${TOOL_IDLE}`}
          >
            <IconGear className="h-4 w-4" />
          </button>
        </div>
        <span
          className={`pointer-events-auto hidden h-9 animate-pop items-center gap-2 rounded-full bg-[rgb(8_20_32/0.62)] px-3.5 text-[11.5px] font-medium shadow-2xl ring-1 ring-white/10 backdrop-blur-xl lg:flex ${
            connected ? "text-[#98F198]" : mpSdkKey && !fallbackNoKey ? (sdkError ? "text-[#F6A39B]" : "text-white/85") : "text-white/60"
          }`}
        >
          <span className="relative grid h-2 w-2 place-items-center">
            {(connected || (mpSdkKey && !fallbackNoKey && !sdkError)) && (
              <span className={`absolute h-2 w-2 animate-ping rounded-full ${connected ? "bg-emerald-400/60" : "bg-amber-300/70"}`} />
            )}
            <span
              className={`h-2 w-2 rounded-full ${
                connected ? "bg-emerald-400" : mpSdkKey && !fallbackNoKey ? (sdkError ? "bg-[#e5484d]" : "bg-amber-300") : "bg-white/40"
              }`}
            />
          </span>
          {connected ? "Conectado" : mpSdkKey && !fallbackNoKey ? (sdkError ? "Erro de conexão" : "Conectando…") : "Sem conexão"}
        </span>
      </div>

      {/* barra do modo ponto */}
      {markMode === "ponto" && (
        <MarkBar accent="brand">
          <span className="hidden px-1.5 text-[12px] font-medium text-white/80 sm:inline">Arraste a mira até o local</span>
          <button onClick={confirmPoint} disabled={!aim} className={`${BAR_BTN} ${BAR_LIGHT}`}>
            Marcar aqui
          </button>
          <button onClick={resetMark} className={`${BAR_BTN} ${BAR_GHOST}`}>
            Cancelar
          </button>
        </MarkBar>
      )}

      {/* área — passo 1: ancorar */}
      {markMode === "rect" && !rectDraft && (
        <MarkBar accent="amber">
          <span className="hidden px-1.5 text-[12px] font-medium text-white/80 sm:inline">Arraste a mira até o centro da área</span>
          <button onClick={anchorRect} disabled={!aim} className={`${BAR_BTN} ${BAR_AMBER}`}>
            Ancorar retângulo
          </button>
          <button onClick={() => startMode("poly")} className="rounded-lg px-1.5 py-1 text-[11.5px] font-medium text-white/60 underline decoration-white/25 underline-offset-2 transition-colors hover:text-white hover:decoration-white/60">
            vértices livres
          </button>
          <button onClick={resetMark} className={`${BAR_BTN} ${BAR_GHOST}`}>
            Cancelar
          </button>
        </MarkBar>
      )}

      {/* área — passo 2: dimensionar */}
      {markMode === "rect" && rectDraft && (
        <MarkBar accent="amber">
          <DimField label="Largura" value={rectDraft.w} onSet={(v) => setDim("w", v)} onStep={(d) => stepDim("w", d)} />
          <span className="text-white/40">×</span>
          <DimField label="Altura" value={rectDraft.h} onSet={(v) => setDim("h", v)} onStep={(d) => stepDim("h", d)} />
          <span className="rounded-lg bg-[#F59E0B]/15 px-2 py-1 text-[12px] font-semibold tabular text-[#F5C36B] ring-1 ring-inset ring-[#F59E0B]/25">
            {(rectDraft.w * rectDraft.h).toFixed(2)} m²
          </span>
          <span className="mx-0.5 hidden h-6 w-px bg-white/10 sm:block" />
          <button onClick={() => rotate(-15)} aria-label="Girar 15 graus anti-horário" className={`${BAR_BTN} ${BAR_GHOST} tabular`}>
            −15°
          </button>
          <button onClick={() => rotate(15)} aria-label="Girar 15 graus horário" className={`${BAR_BTN} ${BAR_GHOST} tabular`}>
            +15°
          </button>
          <button onClick={confirmRect} className={`${BAR_BTN} ${BAR_AMBER}`}>
            Confirmar área
          </button>
          <button onClick={() => { setRectDraft(null); scheduleSample(60); }} className={`${BAR_BTN} ${BAR_GHOST}`}>
            Recomeçar
          </button>
          <button onClick={resetMark} aria-label="Cancelar marcação" className={`${BAR_BTN} ${BAR_GHOST}`}>
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </MarkBar>
      )}

      {/* área — vértices livres (avançado) */}
      {markMode === "poly" && (
        <MarkBar accent="amber">
          <span className="hidden px-1.5 text-[12px] font-medium text-white/80 sm:inline">
            {draft.length === 0
              ? "Arraste a mira e adicione os vértices"
              : `${draft.length} vértice${draft.length > 1 ? "s" : ""}${draft.length >= 3 ? ` · ~${polygonAreaM2(draft).toFixed(1)} m²` : ""}`}
          </span>
          <button onClick={addDraftVertex} disabled={!aim} className={`${BAR_BTN} ${BAR_LIGHT}`}>
            Adicionar ponto
          </button>
          <button onClick={finishPoly} disabled={draft.length < 3} className={`${BAR_BTN} ${BAR_AMBER}`}>
            Concluir
          </button>
          {draft.length > 0 && (
            <button onClick={() => setDraft((d) => d.slice(0, -1))} className={`${BAR_BTN} ${BAR_GHOST}`}>
              Desfazer
            </button>
          )}
          <button onClick={() => startMode("rect")} className="rounded-lg px-1.5 py-1 text-[11.5px] font-medium text-white/60 underline decoration-white/25 underline-offset-2 transition-colors hover:text-white hover:decoration-white/60">
            retângulo
          </button>
          <button onClick={resetMark} aria-label="Cancelar marcação" className={`${BAR_BTN} ${BAR_GHOST}`}>
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </MarkBar>
      )}

      {sdkError && mpSdkKey && (
        <div className="absolute bottom-6 left-4 z-30 flex max-w-md animate-pop items-start gap-3 rounded-2xl bg-[rgb(40_12_12/0.72)] px-4 py-3 text-[11.5px] leading-relaxed text-[#F6C4BE] shadow-2xl ring-1 ring-[#e5484d]/35 backdrop-blur-xl">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#F6A39B]" />
          <p>
          <b className="font-semibold text-white">Tour: {sdkError}.</b>{" "}
          {/invalid key/i.test(sdkError)
            ? <>A chave foi recusada para este endereço. No painel do Matterport, o domínio <b>localhost</b> precisa estar liberado, com a porta vazia ou 80. O tour segue disponível sem marcação e análise.</>
            : <>Confira a chave do tour nas configurações.</>}
          </p>
        </div>
      )}

      {/* modal de análise por IA */}
      {shot && (
        <div className="absolute inset-0 z-40 grid animate-fade place-items-center bg-navy-950/45 p-4 backdrop-blur-sm">
          <div className="flex max-h-full w-full max-w-2xl animate-pop flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-line/70">
            <div className="flex items-center justify-between gap-3 border-b border-line-2 px-6 py-4">
              <h3 className="flex items-center gap-3 text-[15px] font-bold tracking-[-0.015em] text-ink">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-action ring-1 ring-inset ring-[#cfe7fb]">
                  <IconSpark className="h-[18px] w-[18px]" />
                </span>
                Análise da vista atual
              </h3>
              <button
                onClick={() => { setShot(null); setAiResult(null); }}
                aria-label="Fechar"
                className="grid h-9 w-9 place-items-center rounded-xl text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink"
              >
                <IconClose className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-6">
              <img
                src={shot}
                alt="Vista capturada"
                className="mb-4 max-h-56 w-full rounded-2xl object-cover shadow-sm ring-1 ring-line"
              />
              {!aiResult && (
                <>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    rows={2}
                    className="field mb-3 resize-none leading-relaxed"
                    placeholder="O que a IA deve analisar nesta vista?"
                  />
                  {!useApp.getState().aiConfigured && (
                    <p className="mb-3 flex items-start gap-2 rounded-xl bg-[#fdf4e2] px-3.5 py-2.5 text-[12px] leading-relaxed text-warn ring-1 ring-inset ring-[#efdcb0]">
                      <IconAlert className="mt-px h-4 w-4 shrink-0" />
                      O servidor está sem chave da Anthropic — a análise sai simulada, identificada como tal.
                    </p>
                  )}
                  <button onClick={runAnalysis} disabled={analyzing} className="btn btn-primary btn-lg w-full">
                    <IconSpark className={`h-4 w-4 ${analyzing ? "animate-pulse" : ""}`} />
                    {analyzing ? "Analisando a imagem…" : "Analisar"}
                  </button>
                </>
              )}
              {aiError && (
                <p className="mt-3 flex animate-pop items-start gap-2 rounded-xl bg-[#fdeeec] px-3.5 py-2.5 text-[12px] leading-relaxed text-danger ring-1 ring-inset ring-[#f5d0cb]">
                  <IconAlert className="mt-px h-4 w-4 shrink-0" />
                  {aiError}
                </p>
              )}
              {aiResult && (
                <div className="animate-rise">
                  {aiResult.simulated && (
                    <p className="mb-3 flex items-start gap-2 rounded-xl bg-[#fdf4e2] px-3.5 py-2.5 text-[12px] leading-relaxed text-warn ring-1 ring-inset ring-[#efdcb0]">
                      <IconAlert className="mt-px h-4 w-4 shrink-0" />
                      Análise simulada — configure a chave Anthropic para análise real.
                    </p>
                  )}
                  <RichText text={aiResult.text} />
                  <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line-2 pt-4">
                    <button
                      onClick={() => { void navigator.clipboard?.writeText(aiResult.text); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }}
                      className={`btn btn-sm ${copied ? "bg-[#e8f6ed] text-positive ring-1 ring-inset ring-[#c4e5d0]" : "btn-secondary"}`}
                    >
                      {copied && <IconCheck className="h-3.5 w-3.5" />}
                      {copied ? "Copiado" : "Copiar texto"}
                    </button>
                    <span className="text-[11.5px] font-medium text-ink-3">
                      Salva no histórico de análises da obra
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

/** Barra flutuante dos modos de marcação — quebra linha em telas estreitas. */
function MarkBar({ accent, children }: { accent: "brand" | "amber"; children: React.ReactNode }) {
  return (
    <div
      className={`absolute bottom-6 left-1/2 z-30 flex w-max max-w-[94%] -translate-x-1/2 animate-pop flex-wrap items-center justify-center gap-1.5 rounded-2xl bg-[rgb(8_20_32/0.62)] p-1.5 text-white shadow-2xl ring-1 backdrop-blur-xl ${
        accent === "amber" ? "ring-[#F59E0B]/50" : "ring-brand/50"
      }`}
    >
      {children}
    </div>
  );
}

/** Campo numérico de dimensão em metros com steppers de 10 cm. */
function DimField({ label, value, onSet, onStep }: {
  label: string; value: number; onSet: (v: number) => void; onStep: (delta: number) => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <button
        onClick={() => onStep(-0.1)}
        aria-label={`Diminuir ${label.toLowerCase()}`}
        className="grid h-11 w-9 place-items-center rounded-xl bg-white/[0.06] text-white/80 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.12] hover:text-white sm:h-8 sm:w-8"
      >
        −
      </button>
      <span className="flex flex-col items-center">
        <input
          type="number"
          step="0.1"
          min="0.2"
          max="30"
          value={Number(value.toFixed(2))}
          onChange={(e) => onSet(parseFloat(e.target.value))}
          aria-label={`${label} em metros`}
          className="h-11 w-[4.5rem] rounded-xl bg-white/10 text-center text-[12.5px] font-semibold tabular text-white ring-1 ring-inset ring-white/15 transition-shadow focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/70 sm:h-8 sm:w-16"
        />
        <span className="mt-0.5 text-[10px] font-medium text-white/55">{label} (m)</span>
      </span>
      <button
        onClick={() => onStep(0.1)}
        aria-label={`Aumentar ${label.toLowerCase()}`}
        className="grid h-11 w-9 place-items-center rounded-xl bg-white/[0.06] text-white/80 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.12] hover:text-white sm:h-8 sm:w-8"
      >
        +
      </button>
    </span>
  );
}

function tagDescription(discipline: string, assignee: string, dueDate: string, areaM2?: number): string {
  const base = `${discipline} · ${assignee} · prazo ${dueDate}`;
  return areaM2 ? `${base} · área ~${areaM2.toFixed(1)} m²` : base;
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const mpSdkKey = useApp((s) => s.mpSdkKey);
  const setKeys = useApp((s) => s.setKeys);
  const [mp, setMp] = useState(mpSdkKey);

  return (
    <div className="absolute inset-0 z-40 grid animate-fade place-items-center bg-navy-950/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md animate-pop rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-line/70">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-action ring-1 ring-inset ring-[#cfe7fb]">
            <IconGear className="h-[18px] w-[18px]" />
          </span>
          <h3 className="text-[15px] font-bold tracking-[-0.015em] text-ink">Configurações do tour</h3>
        </div>
        <label className="label mb-1.5 block">
          Chave do tour — pinos, foto e posição
        </label>
        <input
          value={mp}
          onChange={(e) => setMp(e.target.value.trim())}
          placeholder="Chave do tour"
          className="field mb-1.5"
        />
        <p className="mb-4 text-[11.5px] leading-relaxed text-ink-3">
          A chave é gratuita no painel do Matterport, em ferramentas de desenvolvedor.
        </p>
        <p className="mb-6 rounded-xl bg-subtle px-3.5 py-2.5 text-[11.5px] leading-relaxed text-ink-2 ring-1 ring-inset ring-line-2">
          A análise por IA sai do servidor. A chave da Anthropic fica no ambiente da API, não nesta página.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => { setKeys(mp, useApp.getState().anthropicKey); onClose(); }}
            className="btn btn-primary h-10 flex-1"
          >
            Salvar
          </button>
          <button onClick={onClose} className="btn btn-secondary h-10 px-4">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
