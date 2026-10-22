import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { levelsOf, projectById } from "../data/catalog";
import { analyzeFloorplan } from "../lib/ai";
import { fileToDataUrl, srcToDataUrl } from "../lib/image";
import { caminhoDaObra, useObraId } from "../obra";
import { useApp } from "../store";
import type { Floorplan, FloorplanPin } from "../types";
import RichText from "../components/RichText";
import {
  EmptyState,
  IconAlert,
  IconArrowRight,
  IconCrosshair,
  IconLayers,
  IconPlus,
  IconRotate360,
  IconSpark,
  Micro,
  StatusChip,
} from "../components/ui";

/* ícones locais, no mesmo traço 24 de `ui.tsx` */
const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
const IconMinus = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg {...stroke} className={className}>
    <path d="M5 12h14" />
  </svg>
);
const IconUpload = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg {...stroke} className={className}>
    <path d="M12 15V4" />
    <path d="M7.5 8.5L12 4l4.5 4.5" />
    <path d="M4 15v2.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V15" />
  </svg>
);
const IconTrash = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg {...stroke} className={className}>
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

/** Fundo da prancheta: papel azulado com grade de desenho técnico. */
const PRANCHETA =
  "bg-subtle bg-[linear-gradient(rgb(14_54_86/0.05)_1px,transparent_1px),linear-gradient(90deg,rgb(14_54_86/0.05)_1px,transparent_1px)] bg-[size:24px_24px]";

/** Plantas exportadas do modelo Matterport da obra, prontas para carregar. */
const PLANTAS_DO_MODELO = [
  { name: "Pavimento 1", src: `${import.meta.env.BASE_URL}plantas/pavimento-1.png` },
  { name: "Pavimento 2", src: `${import.meta.env.BASE_URL}plantas/pavimento-2.png` },
  { name: "Pavimento 3", src: `${import.meta.env.BASE_URL}plantas/pavimento-3.png` },
];

/**
 * Módulo de plantas: o projeto entrando no sistema.
 *
 * Sem a planta, a plataforma só registra o que existe; com ela, passa a haver
 * referência do que deveria existir. Aqui a planta é carregada, lida pela IA e
 * usada para marcar ocorrências por posição no desenho.
 */
export default function Plantas() {
  const projectId = useObraId();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const project = projectById(projectId);

  const floorplans = useApp((s) => s.floorplans).filter((f) => f.projectId === projectId);
  const addFloorplan = useApp((s) => s.addFloorplan);
  const updateFloorplan = useApp((s) => s.updateFloorplan);
  const removeFloorplan = useApp((s) => s.removeFloorplan);
  const addPin = useApp((s) => s.addFloorplanPin);
  const updatePin = useApp((s) => s.updateFloorplanPin);
  const removePin = useApp((s) => s.removeFloorplanPin);
  const issues = useApp((s) => s.issues);
  const addIssue = useApp((s) => s.addIssue);
  const requestFlyToPose = useApp((s) => s.requestFlyToPose);
  const requestFlyTo = useApp((s) => s.requestFlyTo);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [openPin, setOpenPin] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [partial, setPartial] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  const levels = useMemo(() => levelsOf(projectId), [projectId]);
  const plan = floorplans.find((f) => f.id === selectedId) ?? floorplans[0] ?? null;

  useEffect(() => {
    if (plan && selectedId !== plan.id) setSelectedId(plan.id);
  }, [plan, selectedId]);

  // deep link vindo da pendência: ?plan=<id>&pin=<id>
  useEffect(() => {
    const wanted = params.get("plan");
    if (!wanted || wanted === selectedId) return;
    if (!floorplans.some((f) => f.id === wanted)) return;
    setSelectedId(wanted);
    const pin = params.get("pin");
    if (pin) setOpenPin(pin);
    setParams({}, { replace: true });
  }, [params, selectedId, floorplans, setParams]);

  // ler uma prancha leva de 30s a alguns minutos; o relógio evita a sensação de travado
  useEffect(() => {
    if (!analyzing) return;
    const t = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, [analyzing]);

  if (!project) return null;

  const novaPlanta = (name: string, imageSrc: string, levelId?: string): Floorplan => ({
    // criar três pranchas no mesmo clique colide se o id vier só do relógio
    id: `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    levelId,
    name,
    imageSrc,
    pins: [],
    createdAt: new Date().toISOString(),
  });

  const carregarDoModelo = () => {
    const existentes = new Set(floorplans.map((f) => f.name));
    PLANTAS_DO_MODELO.filter((p) => !existentes.has(p.name)).forEach((p, i) => {
      const level = levels[i];
      addFloorplan(novaPlanta(p.name, p.src, level?.id));
    });
    setError(null);
  };

  const enviarArquivo = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Envie a planta como imagem (PNG ou JPG). PDF ainda não é lido — exporte a prancha como imagem.");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      addFloorplan(novaPlanta(file.name.replace(/\.[^.]+$/, ""), dataUrl));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ler o arquivo");
    }
  };

  const analisar = async () => {
    if (!plan) return;
    setAnalyzing(true);
    setError(null);
    setPartial("");
    setElapsed(0);
    try {
      const dataUrl = await srcToDataUrl(plan.imageSrc);
      const r = await analyzeFloorplan(dataUrl, { project: project.name, plan: plan.name, projectId }, setPartial);
      updateFloorplan(plan.id, {
        analysis: r.text,
        analysisAt: new Date().toISOString(),
        analysisSimulated: r.simulated,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ler a planta");
    } finally {
      setAnalyzing(false);
      setPartial("");
    }
  };

  const marcarNaPlanta = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!plan || !marking) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pin: FloorplanPin = {
      id: `pin-${Date.now()}`,
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      label: `Ponto ${plan.pins.length + 1}`,
      note: "",
      createdAt: new Date().toISOString(),
    };
    addPin(plan.id, pin);
    setOpenPin(pin.id);
    setMarking(false);
  };

  const abrirNaoConformidade = (pin: FloorplanPin) => {
    if (!plan) return;
    const issue = addIssue({
      projectId,
      local: `${plan.name} · ${pin.label}`,
      levelId: plan.levelId,
      origin: "planta",
      floorplanId: plan.id,
      pinId: pin.id,
      pose: pin.pose,
      title: pin.label,
      description: pin.note || "Ocorrência marcada sobre a planta baixa do pavimento.",
      discipline: "Alvenaria",
      severity: "media",
      assignee: "Empreiteira Silva & Souza",
      dueDate: new Date(Date.now() + 12096e5).toISOString().slice(0, 10),
    });
    updatePin(plan.id, pin.id, { issueId: issue.id });
  };

  const pinAberto = plan?.pins.find((p) => p.id === openPin) ?? null;
  // a prancha e a obra falam do mesmo pavimento — é o que liga desenho e cobrança
  const doPavimento = issues.filter(
    (i) => i.projectId === projectId && plan?.levelId && i.levelId === plan.levelId && i.status !== "resolvido",
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3 lg:flex-row lg:overflow-hidden lg:p-0">
      {/* prancheta */}
      <section className="flex min-h-[70vh] flex-1 flex-col overflow-hidden rounded-[22px] bg-white shadow-sm ring-1 ring-line/70 lg:min-h-0">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-2 bg-white/80 px-4 py-2.5 backdrop-blur-xl">
          <div className="mr-auto flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-action ring-1 ring-inset ring-[#cfe7fb]">
              <IconLayers className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <h1 className="text-[15px] font-bold leading-tight tracking-[-0.015em] text-ink">Plantas</h1>
              {plan && <Micro className="block truncate">{plan.name}</Micro>}
            </div>
          </div>

          {plan && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="segmented">
                <button
                  onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100))}
                  aria-label="Reduzir zoom"
                  className="grid h-7 w-7 place-items-center rounded-lg text-ink-2 transition hover:bg-white hover:text-ink hover:shadow-sm"
                >
                  <IconMinus className="h-3.5 w-3.5" />
                </button>
                <span className="w-11 text-center text-[12px] font-semibold tabular text-ink-2">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
                  aria-label="Aumentar zoom"
                  className="grid h-7 w-7 place-items-center rounded-lg text-ink-2 transition hover:bg-white hover:text-ink hover:shadow-sm"
                >
                  <IconPlus className="h-3.5 w-3.5" />
                </button>
              </span>
              <button
                onClick={() => setMarking((v) => !v)}
                aria-pressed={marking}
                className={`btn ${marking ? "btn-accent" : "btn-secondary"}`}
              >
                <IconCrosshair className="h-4 w-4" />
                {marking ? "Clique na planta" : "Marcar ponto"}
              </button>
              <button onClick={analisar} disabled={analyzing} className="btn btn-primary">
                <IconSpark className={`h-4 w-4 ${analyzing ? "animate-pulse" : ""}`} />
                <span className="tabular">
                  {analyzing ? `Lendo a planta… ${elapsed}s` : plan.analysis ? "Reanalisar planta" : "Analisar planta"}
                </span>
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="mx-4 mt-3 flex shrink-0 animate-pop items-start gap-2 rounded-xl bg-[#fdeeec] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-danger ring-1 ring-inset ring-[#f5d0cb]">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        <div className={`min-h-0 flex-1 overflow-auto p-5 ${PRANCHETA}`}>
          {!plan ? (
            <div className="grid min-h-full place-items-center">
              <div className="card w-full max-w-lg animate-rise">
                <EmptyState
                  icon={<IconLayers className="h-6 w-6" />}
                  title="Nenhuma planta carregada"
                  className="py-12"
                  action={
                    <>
                      <button onClick={carregarDoModelo} className="btn btn-primary btn-lg">
                        <IconRotate360 className="h-4 w-4" />
                        Usar as plantas do modelo 360
                      </button>
                      <button onClick={() => fileRef.current?.click()} className="btn btn-secondary btn-lg">
                        <IconUpload className="h-4 w-4" />
                        Enviar arquivo
                      </button>
                    </>
                  }
                >
                  Sem a planta, a plataforma registra o que existe mas não sabe o que deveria
                  existir. Carregue as pranchas do pavimento para dar essa referência à obra.
                </EmptyState>
              </div>
            </div>
          ) : (
            <div
              key={plan.id}
              onClick={marcarNaPlanta}
              className={`relative mx-auto w-fit animate-rise rounded-2xl bg-white shadow-lg ring-1 transition-[box-shadow] duration-300 ${
                marking ? "cursor-crosshair ring-2 ring-brand/70 shadow-[0_0_0_6px_rgb(0_155_255/0.12),var(--shadow-lg)]" : "ring-line/70"
              }`}
              style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? "980px" : "none" }}
            >
              <img src={plan.imageSrc} alt={`Planta ${plan.name}`} className="block w-full rounded-2xl" />

              {plan.pins.map((pin, i) => {
                const linked = issues.find((x) => x.id === pin.issueId);
                return (
                  <button
                    key={pin.id}
                    onClick={(e) => { e.stopPropagation(); setOpenPin(openPin === pin.id ? null : pin.id); }}
                    title={pin.label}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                  >
                    <span
                      className={`grid h-7 w-7 place-items-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow-md transition-[scale,box-shadow] duration-200 hover:scale-110 ${
                        linked
                          ? linked.status === "resolvido" ? "bg-positive" : "bg-danger"
                          : pin.pose ? "bg-action" : "bg-ink-3"
                      } ${openPin === pin.id ? "scale-110 ring-4 ring-brand/35" : ""}`}
                    >
                      {i + 1}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* painel lateral */}
      <aside className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-[22px] bg-white shadow-sm ring-1 ring-line/70 lg:w-[380px]">
        {/* pranchas */}
        <div className="shrink-0 border-b border-line-2 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="card-title flex items-center gap-2">
              Pranchas
              <span className="min-w-[22px] rounded-full bg-ink/[0.06] px-1.5 py-px text-center text-[11px] font-bold tabular text-ink-2">
                {floorplans.length}
              </span>
            </h2>
            <button onClick={() => fileRef.current?.click()} className="btn btn-ghost btn-sm -mr-1.5 text-action hover:text-action">
              <IconPlus className="h-3.5 w-3.5" />
              Enviar
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void enviarArquivo(f);
              e.target.value = "";
            }}
          />
          {floorplans.length === 0 ? (
            <button
              onClick={carregarDoModelo}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-field bg-subtle px-3 py-3 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-brand/50 hover:bg-brand-soft/60 hover:text-action"
            >
              <IconRotate360 className="h-4 w-4" />
              Carregar as 3 plantas do modelo 360
            </button>
          ) : (
            <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 py-1">
              {floorplans.map((f, idx) => (
                <button
                  key={f.id}
                  onClick={() => { setSelectedId(f.id); setOpenPin(null); setZoom(1); }}
                  className={`reveal shrink-0 overflow-hidden rounded-xl bg-white text-left transition-[box-shadow] duration-200 ${
                    plan?.id === f.id ? "shadow-md ring-2 ring-brand" : "ring-1 ring-line hover:shadow-md hover:ring-field"
                  }`}
                  style={{ ["--i" as string]: Math.min(idx, 12) }}
                >
                  <span className="block bg-subtle p-1">
                    <img src={f.imageSrc} alt="" className="h-16 w-24 rounded-lg bg-white object-contain" />
                  </span>
                  <span className={`block max-w-[104px] truncate border-t border-line-2 px-2 py-1.5 text-[11px] font-semibold ${plan?.id === f.id ? "text-action" : "text-ink"}`}>
                    {f.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* ponto selecionado */}
          {plan && pinAberto && (
            <div key={pinAberto.id} className="m-3 animate-pop rounded-2xl bg-subtle p-4 ring-1 ring-inset ring-line-2">
              <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-white text-action shadow-xs ring-1 ring-inset ring-line-2">
                  <IconCrosshair className="h-3.5 w-3.5" />
                </span>
                Ponto na planta
              </p>
              <input
                value={pinAberto.label}
                onChange={(e) => updatePin(plan.id, pinAberto.id, { label: e.target.value })}
                className="field mb-2 font-medium"
              />
              <textarea
                rows={3}
                value={pinAberto.note}
                placeholder="O que foi observado neste ponto do projeto"
                onChange={(e) => updatePin(plan.id, pinAberto.id, { note: e.target.value })}
                className="field mb-2 resize-none text-[12.5px] leading-relaxed"
              />
              <Micro className="mb-2 block tabular">
                x {(pinAberto.x * 100).toFixed(1)}% · y {(pinAberto.y * 100).toFixed(1)}%
                {pinAberto.pose ? " · vista do tour guardada" : " · sem vista no tour"}
              </Micro>
              {!pinAberto.pose && (
                <p className="mb-3 rounded-xl bg-white px-3 py-2 text-[11.5px] leading-relaxed text-ink-3 ring-1 ring-inset ring-line-2">
                  Para este ponto abrir o 360 no lugar certo, vá ao Tour 360, ande até aqui e use
                  <b className="font-semibold text-ink"> vincular vista</b> na planta flutuante.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {pinAberto.pose && (
                  <button
                    onClick={() => {
                      const iss = issues.find((x) => x.id === pinAberto.issueId);
                      if (iss?.tagId || iss?.mp) requestFlyTo(iss.id);
                      else requestFlyToPose(pinAberto.pose!);
                      navigate(caminhoDaObra(projectId, "tour"));
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    <IconRotate360 className="h-3.5 w-3.5 text-action" />
                    Ir a este ponto no tour
                  </button>
                )}
                {pinAberto.issueId ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fdeeec] px-2.5 py-1 text-[11px] font-semibold text-danger ring-1 ring-inset ring-[#f5d0cb]">
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                    Não conformidade aberta
                  </span>
                ) : (
                  <button onClick={() => abrirNaoConformidade(pinAberto)} className="btn btn-primary btn-sm">
                    <IconPlus className="h-3.5 w-3.5" />
                    Abrir não conformidade
                  </button>
                )}
                <button
                  onClick={() => { removePin(plan.id, pinAberto.id); setOpenPin(null); }}
                  className="btn btn-ghost btn-sm ml-auto px-2 text-danger hover:bg-[#fdeeec] hover:text-danger"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                  Excluir ponto
                </button>
              </div>
            </div>
          )}

          {/* leitura da planta */}
          <div className="px-4 py-4">
            <h2 className="mb-3 flex items-center gap-2 card-title">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-action ring-1 ring-inset ring-[#cfe7fb]">
                <IconSpark className="h-3.5 w-3.5" />
              </span>
              Leitura da planta
            </h2>
            {!plan ? (
              <p className="text-[12.5px] text-ink-3">Carregue uma prancha para analisar.</p>
            ) : analyzing ? (
              <>
                <p className="mb-3 flex items-center gap-2 text-[12px] font-medium text-ink-2">
                  <span className="relative grid h-2 w-2 place-items-center">
                    <span className="absolute h-2 w-2 animate-ping rounded-full bg-brand/60" />
                    <span className="h-2 w-2 rounded-full bg-brand" />
                  </span>
                  <span className="tabular">
                    {partial
                      ? `Escrevendo a leitura — ${elapsed}s`
                      : `Lendo o desenho — ${elapsed}s`}
                  </span>
                </p>
                {partial ? (
                  <RichText text={partial} />
                ) : (
                  <>
                    <div className="mb-3 space-y-2" aria-hidden>
                      <div className="skeleton h-3 w-11/12" />
                      <div className="skeleton h-3 w-4/5" />
                      <div className="skeleton h-3 w-2/3" />
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-ink-3">
                      A IA está percorrendo a prancha inteira: ambientes, circulação, pontos de
                      atenção e o que conferir em campo. Costuma levar de 30 segundos a dois minutos.
                    </p>
                  </>
                )}
              </>
            ) : plan.analysis ? (
              <div className="animate-fade">
                {plan.analysisSimulated && (
                  <p className="mb-3 flex items-start gap-2 rounded-xl bg-[#fdf4e2] px-3 py-2 text-[11.5px] leading-relaxed text-warn ring-1 ring-inset ring-[#efdcb0]">
                    <IconAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                    Leitura simulada — coloque OPENAI_API_KEY em apps/api/.env para a leitura real.
                  </p>
                )}
                <RichText text={plan.analysis} />
                {plan.analysisAt && (
                  <Micro className="mt-3 block">
                    Lida em {new Date(plan.analysisAt).toLocaleString("pt-BR")}
                  </Micro>
                )}
              </div>
            ) : (
              <p className="rounded-xl bg-subtle px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2 ring-1 ring-inset ring-line-2">
                Use <b className="font-semibold text-ink">Analisar planta</b> para a IA identificar
                ambientes, circulação e pontos de atenção construtivos — e apontar o que conferir
                em campo.
              </p>
            )}
          </div>

          {/* pontos marcados */}
          {plan && plan.pins.length > 0 && (
            <div className="border-t border-line-2 px-4 py-4">
              <h2 className="card-title mb-2 flex items-center gap-2">
                Pontos marcados
                <span className="min-w-[22px] rounded-full bg-ink/[0.06] px-1.5 py-px text-center text-[11px] font-bold tabular text-ink-2">
                  {plan.pins.length}
                </span>
              </h2>
              <div className="-mx-2 flex flex-col gap-0.5">
                {plan.pins.map((pin, i) => {
                  const linked = issues.find((x) => x.id === pin.issueId);
                  return (
                    <button
                      key={pin.id}
                      onClick={() => setOpenPin(pin.id)}
                      className={`flex items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors ${
                        openPin === pin.id ? "bg-brand-soft/70" : "hover:bg-subtle"
                      }`}
                    >
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10.5px] font-bold text-white shadow-xs ${
                          linked ? "bg-danger" : "bg-action"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold text-ink">{pin.label}</span>
                        {pin.note && (
                          <span className="block truncate text-[11.5px] text-ink-3">{pin.note}</span>
                        )}
                      </span>
                      {linked && <StatusChip status={linked.status} nc={linked.ncStatus} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* o que a obra deve a este pavimento */}
          {plan && (
            <div className="border-t border-line-2 px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="card-title flex items-center gap-2">
                  Não conformidades deste pavimento
                  <span className="min-w-[22px] rounded-full bg-ink/[0.06] px-1.5 py-px text-center text-[11px] font-bold tabular text-ink-2">
                    {doPavimento.length}
                  </span>
                </h2>
                <Link
                  to={caminhoDaObra(projectId, "nao-conformidades")}
                  className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-action transition-colors hover:text-ink"
                >
                  Ver todas
                  <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {doPavimento.length === 0 ? (
                <p className="text-[12px] leading-relaxed text-ink-3">
                  {plan.levelId
                    ? "Nenhuma não conformidade aberta neste pavimento."
                    : "Esta prancha não está vinculada a um pavimento, então não puxa não conformidades."}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {doPavimento.map((i, idx) => (
                    <div
                      key={i.id}
                      className="reveal rounded-xl bg-subtle p-3 ring-1 ring-inset ring-line-2"
                      style={{ ["--i" as string]: Math.min(idx, 12) }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12.5px] font-semibold leading-snug text-ink">{i.title}</p>
                        <StatusChip status={i.status} nc={i.ncStatus} />
                      </div>
                      <Micro className="mt-1 block">
                        {i.local} · {i.discipline} · prazo{" "}
                        {i.dueDate.slice(5).split("-").reverse().join("/")}
                      </Micro>
                      {(i.pose || i.mp) && (
                        <button
                          onClick={() => { requestFlyTo(i.id); navigate(caminhoDaObra(projectId, "tour")); }}
                          className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-action transition-colors hover:text-ink"
                        >
                          <IconRotate360 className="h-3.5 w-3.5" />
                          Ver no tour
                          <IconArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {plan && (
          <div className="shrink-0 border-t border-line-2 px-3 py-2.5">
            <button
              onClick={() => {
                if (confirm(`Remover a prancha "${plan.name}" e seus ${plan.pins.length} pontos?`)) {
                  removeFloorplan(plan.id);
                  setSelectedId(null);
                  setOpenPin(null);
                }
              }}
              className="btn btn-ghost btn-sm text-ink-3 hover:bg-[#fdeeec] hover:text-danger"
            >
              <IconTrash className="h-3.5 w-3.5" />
              Remover esta prancha
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
