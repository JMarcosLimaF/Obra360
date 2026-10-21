import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import MatterportViewer, { mpState } from "../components/MatterportViewer";
import { NewIssueForm } from "../components/IssuePanel";
import { fmtDate, levelsOf, projectById } from "../data/catalog";
import { caminhoDaObra, useObraId } from "../obra";
import { flyToPose, type MpSdk } from "../lib/matterport";
import { downscaleDataUrl, isBlankFrame } from "../lib/image";
import { draftRdo, observeStop } from "../lib/ai";
import { useApp } from "../store";
import {
  RDO_PERIOD_LABEL, RDO_PHOTO_KIND_LABEL, RDO_WEATHER_LABEL,
  type Issue, type NcEvidence, type RdoPeriod, type RdoPhoto, type RdoPhotoKind, type RdoStop, type RdoWeather,
} from "../types";
import {
  EmptyState,
  IconArrowRight,
  IconCamera,
  IconChevronDown,
  IconClose,
  IconCrosshair,
  IconPlus,
  IconReport,
  IconRotate360,
  IconSpark,
  Micro,
  StatusChip,
} from "../components/ui";

/* Ícones locais — mesmo traço 24 de `ui.tsx` */
const glyph = (className = "h-4 w-4") => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true,
});
const IconArrowLeft = ({ className }: { className?: string }) => (
  <svg {...glyph(className)}><path d="M19 12H5" /><path d="M11 6l-6 6 6 6" /></svg>
);
const IconSun = ({ className }: { className?: string }) => (
  <svg {...glyph(className)}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>
);
const IconAlertTri = ({ className }: { className?: string }) => (
  <svg {...glyph(className)}><path d="M10.3 3.9L2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4" /><path d="M12 17h.01" /></svg>
);
const IconTrash = ({ className }: { className?: string }) => (
  <svg {...glyph(className)}><path d="M4 7h16" /><path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" /><path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" /></svg>
);

/** Vidro escuro das sobreposições do tour (DESIGN.md). */
const GLASS = "bg-[rgb(8_20_32/0.62)] text-white ring-1 ring-white/10 backdrop-blur-xl";

const PERIODS: RdoPeriod[] = ["manha", "tarde", "noite"];
const KINDS = Object.keys(RDO_PHOTO_KIND_LABEL) as RdoPhotoKind[];

/** Cor da tarja por classificação — o anexo se lê por cor antes de se ler por texto. */
const KIND_CHIP: Record<RdoPhotoKind, string> = {
  panoramica: "bg-brand-soft text-action ring-[#cfe7fb]",
  detalhe: "bg-subtle text-ink-2 ring-line",
  nao_conformidade: "bg-[#fdeeec] text-danger ring-[#f5d0cb]",
  encoberto: "bg-[#fdf4e2] text-warn ring-[#efdcb0]",
  seguranca: "bg-[#e8f6ed] text-positive ring-[#c4e5d0]",
};

/**
 * Visita guiada: o tour à esquerda, o caderno de campo à direita.
 *
 * A visita é uma caminhada por frentes de serviço. Em cada frente o engenheiro
 * fotografa quantas vistas quiser — panorâmica, detalhe, não conformidade,
 * serviço a ser encoberto — e a IA redige a observação lendo o conjunto.
 */
export default function RdoVisita() {
  const { rdoId = "" } = useParams();
  const projectId = useObraId();
  const navigate = useNavigate();
  const project = projectById(projectId);

  const rdo = useApp((s) => s.rdos.find((r) => r.id === rdoId));
  const addRdoStop = useApp((s) => s.addRdoStop);
  const updateRdoStop = useApp((s) => s.updateRdoStop);
  const removeRdoStop = useApp((s) => s.removeRdoStop);
  const addRdoPhoto = useApp((s) => s.addRdoPhoto);
  const updateRdoPhoto = useApp((s) => s.updateRdoPhoto);
  const removeRdoPhoto = useApp((s) => s.removeRdoPhoto);
  const updateRdo = useApp((s) => s.updateRdo);
  const issues = useApp((s) => s.issues);
  const ncTransition = useApp((s) => s.ncTransition);
  const requestFlyTo = useApp((s) => s.requestFlyTo);
  const pendingAnchor = useApp((s) => s.pendingAnchor);

  const [sdk, setSdk] = useState<MpSdk | null>(null);
  /** o viewer montado avisa por onSdkChange; mpState cobre a primeira renderização */
  const liveSdk = () => sdk ?? mpState.sdk;
  const [busy, setBusy] = useState<null | "foto" | "frente">(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [composed, setComposed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  const levels = useMemo(() => levelsOf(projectId), [projectId]);
  const stops = useMemo(() => rdo?.stops ?? [], [rdo]);
  const locked = rdo?.status === "fechado";

  const activeStop = stops.find((s) => s.id === activeId) ?? stops.at(-1) ?? null;

  // o que a obra já devia neste pavimento — conferir de pé na frente de serviço
  const [reprovando, setReprovando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [avisoNc, setAvisoNc] = useState<string | null>(null);

  /** A foto da frente vira a evidência exigida pelo trâmite, no tipo que a ação pede. */
  const fotoDaFrente = useCallback(
    (kind: NcEvidence["kind"]): NcEvidence | null => {
      const foto = activeStop?.photos.at(-1);
      if (!foto) return null;
      return {
        id: `ev-img-${foto.id}-${kind}`,
        kind,
        imageDataUrl: foto.imageDataUrl,
        pose: foto.pose,
        author: rdo?.responsible ?? "",
        role: "fiscalizacao",
        note: foto.caption || `Foto da frente ${activeStop?.label ?? ""}`,
        createdAt: foto.createdAt,
      };
    },
    [activeStop, rdo],
  );

  /** Aceitar em campo exige a foto da conferência — é a regra do trâmite, não da tela. */
  const aprovarNaVisita = (nc: Issue) => {
    const evidence = fotoDaFrente("verificacao");
    if (!evidence) {
      setAvisoNc("Fotografe a frente antes de aceitar o reparo: o aceite exige registro da conferência.");
      return;
    }
    const msg = ncTransition(nc.id, "aprovar", {
      evidence,
      note: `Conferido em campo na frente ${activeStop?.label ?? ""}.`,
      rdoId: rdo?.id,
      rdoNumber: rdo?.number,
    });
    setAvisoNc(msg ?? `${nc.code} aceita e encerrada.`);
  };

  const reprovarNaVisita = (nc: Issue) => {
    const msg = ncTransition(nc.id, "reprovar", {
      note: motivo.trim(),
      rdoId: rdo?.id,
      rdoNumber: rdo?.number,
    });
    if (!msg) { setReprovando(null); setMotivo(""); }
    setAvisoNc(msg ?? `${nc.code} devolvida à contratada com novo prazo.`);
  };

  // quem acabou de fotografar a frente não deve ser obrigado a fotografar de novo
  const evidenciaDaFrente = useMemo<NcEvidence | null>(() => {
    const foto = activeStop?.photos.at(-1);
    if (!foto) return null;
    return {
      id: `ev-img-${foto.id}`,
      kind: "abertura",
      imageDataUrl: foto.imageDataUrl,
      pose: foto.pose,
      author: rdo?.responsible ?? "",
      role: "fiscalizacao",
      note: foto.caption || `Foto da frente ${activeStop?.label ?? ""}`,
      createdAt: foto.createdAt,
    };
  }, [activeStop, rdo]);

  const pendentesDaFrente = issues.filter(
    (i) =>
      i.projectId === projectId &&
      activeStop?.levelId &&
      i.levelId === activeStop.levelId &&
      i.status !== "resolvido",
  );
  const totalPhotos = stops.reduce((n, s) => n + s.photos.length, 0);
  const totalIssues = new Set(stops.flatMap((s) => s.issueIds)).size;

  /* Pendências criadas depois de registrar uma frente pertencem a ela. */
  const seenIssues = useRef<Set<string> | null>(null);
  useEffect(() => {
    const mine = issues.filter((i) => i.projectId === projectId).map((i) => i.id);
    if (seenIssues.current === null) {
      seenIssues.current = new Set(mine);
      return;
    }
    const fresh = mine.filter((id) => !seenIssues.current!.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => seenIssues.current!.add(id));
    if (rdo && activeStop && !locked) {
      updateRdoStop(rdo.id, activeStop.id, { issueIds: [...activeStop.issueIds, ...fresh] });
    }
  }, [issues, projectId, rdo, activeStop, updateRdoStop, locked]);

  /* Redige a observação da frente lendo todas as fotos dela. */
  const observe = useCallback(
    async (stop: RdoStop, images: string[]) => {
      if (!rdo || !project || images.length === 0) return;
      updateRdoStop(rdo.id, stop.id, { aiStatus: "analisando" });
      try {
        const r = await observeStop(images, { project: project.name, label: stop.label, projectId });
        updateRdoStop(rdo.id, stop.id, {
          observation: r.text,
          aiStatus: "pronto",
          aiSimulated: r.simulated,
        });
      } catch {
        updateRdoStop(rdo.id, stop.id, { aiStatus: "erro" });
      }
    },
    [rdo, project, projectId, updateRdoStop],
  );

  /* Fotografa a vista atual e anexa à frente ativa (cria uma se não houver). */
  const capture = useCallback(async () => {
    const s = mpState.sdk ?? sdk;
    if (!s || !rdo || !project || locked || busy) return;
    setBusy("foto");
    setError(null);
    try {
      const shot = await s.Renderer.takeScreenShot(
        { width: 1600, height: 900 },
        { mattertags: false, sweeps: false },
      );
      if (await isBlankFrame(shot)) {
        setError("A vista ainda não terminou de carregar — aguarde a cena aparecer e fotografe de novo.");
        return;
      }
      const pose = await s.Camera.getPose().catch(() => null);
      const thumb = await downscaleDataUrl(shot, 720, 0.62);
      const stopPose = pose?.sweep ? { sweep: pose.sweep, rotation: pose.rotation } : undefined;

      let target = activeStop;
      if (!target) {
        const level = levels[0];
        target = {
          id: `stop-${Date.now()}`,
          label: level?.name ?? "Ponto 1",
          levelId: level?.id,
          imageDataUrl: "",
          photos: [],
          pose: stopPose,
          observation: "",
          aiStatus: "pendente",
          issueIds: [],
          createdAt: new Date().toISOString(),
        };
        addRdoStop(rdo.id, target);
        setActiveId(target.id);
      }

      const photo: RdoPhoto = {
        id: `ph-${Date.now()}`,
        imageDataUrl: thumb,
        caption: "",
        kind: "panoramica",
        pose: stopPose,
        createdAt: new Date().toISOString(),
      };
      addRdoPhoto(rdo.id, target.id, photo);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 180);

      // a primeira foto da frente já rende a observação; as demais só ao pedir
      if (target.photos.length === 0) void observe(target, [shot]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao fotografar a vista");
    } finally {
      setBusy(null);
    }
  }, [activeStop, addRdoPhoto, addRdoStop, busy, levels, locked, observe, project, rdo, sdk]);

  /* Abre uma nova frente; a próxima foto entra nela. */
  const newFront = () => {
    if (!rdo || locked || busy) return;
    const registered = new Set(stops.map((x) => x.levelId).filter(Boolean));
    const level = levels.find((l) => !registered.has(l.id));
    const stop: RdoStop = {
      id: `stop-${Date.now()}`,
      label: level?.name ?? `Ponto ${stops.length + 1}`,
      levelId: level?.id,
      imageDataUrl: "",
      photos: [],
      observation: "",
      aiStatus: "pendente",
      issueIds: [],
      createdAt: new Date().toISOString(),
    };
    addRdoStop(rdo.id, stop);
    setActiveId(stop.id);
  };

  // atalho de teclado: F fotografa sem tirar a mão do tour
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "f" || e.key === "F") { e.preventDefault(); void capture(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture]);

  if (!project || !rdo) return null;
  if (!project.matterportId) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="card w-full max-w-md animate-pop">
          <EmptyState icon={<IconRotate360 className="h-6 w-6" />} title="Esta obra não tem tour 360 vinculado." />
        </div>
      </div>
    );
  }

  const goToPose = async (pose?: { sweep: string; rotation: { x: number; y: number } }) => {
    const s = liveSdk();
    if (s && pose) await flyToPose(s, pose);
  };

  const compose = async () => {
    if (stops.length === 0) {
      setError("Registre ao menos uma frente antes de compor o relatório.");
      return;
    }
    const semFoto = stops.filter((s) => s.photos.length === 0).map((s) => s.label);
    setComposing(true);
    setError(null);
    setWarning(semFoto.length ? `Frentes sem foto ficaram de fora: ${semFoto.join(", ")}.` : null);
    try {
      const draft = await draftRdo(
        stops
          .filter((s) => s.photos.length > 0)
          .map((s) => ({
            imageDataUrl: s.photos[0].imageDataUrl,
            previousAnalysis: s.observation,
            label: s.label,
          })),
        {
          project: project.name,
          date: fmtDate(rdo.date),
          levels: stops.map((s) => s.label).join(", "),
          openIssues: issues
            .filter((i) => i.projectId === projectId && i.status !== "resolvido")
            .map((i) => `${i.title} (${i.local})`),
          projectId,
        },
      );
      updateRdo(rdo.id, {
        servicesExecuted: draft.servicesExecuted,
        occurrences: draft.occurrences,
        nonConformities: draft.nonConformities,
        notes: draft.notes,
        issueIds: [...new Set([...rdo.issueIds, ...stops.flatMap((s) => s.issueIds)])],
        aiDrafted: true,
        aiSimulated: draft.simulated,
      });
      setComposed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao compor o relatório");
    } finally {
      setComposing(false);
    }
  };

  const planned = Math.max(levels.length, stops.length, 1);

  const ncAberto = pendentesDaFrente.length > 0;

  return (
    <div className="flex h-full flex-col gap-3 px-3 pb-3 lg:px-0 lg:pb-0">
      {/* barra da visita */}
      <div className="flex shrink-0 animate-fade flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line/80 bg-white/85 px-2.5 py-2 shadow-sm backdrop-blur-xl sm:px-3">
        <button
          onClick={() => navigate(caminhoDaObra(projectId, "diario"))}
          aria-label="Diário de obra"
          className="btn btn-ghost btn-sm"
        >
          <IconArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Diário de obra</span>
        </button>
        <span className="hidden h-6 w-px bg-line sm:block" />
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-brand-soft to-white text-action ring-1 ring-inset ring-[#d4ebfb]">
            <IconRotate360 className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-[14.5px] font-bold leading-tight tracking-[-0.015em] text-ink tabular">
              RDO nº {String(rdo.number).padStart(3, "0")}
            </span>
            <Micro className="block truncate">Visita guiada · {fmtDate(rdo.date)}</Micro>
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigate(`${caminhoDaObra(projectId, "diario")}?rdo=${rdo.id}`)}
            aria-label="Documento"
            className="btn btn-secondary"
          >
            <IconReport className="h-4 w-4" />
            <span className="hidden sm:inline">Documento</span>
          </button>
          <button
            onClick={compose}
            disabled={composing || locked || stops.length === 0}
            className="btn btn-primary"
          >
            <IconSpark className={`h-4 w-4 ${composing ? "animate-pulse" : ""}`} />
            {composing ? "Compondo…" : "Compor RDO"}
          </button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* tour + obturador */}
        <div className="relative h-[46vh] shrink-0 animate-fade overflow-hidden rounded-2xl bg-navy-950 shadow-sm ring-1 ring-line/80 lg:h-auto lg:min-h-0 lg:flex-1">
          <MatterportViewer
            modelId={project.matterportId}
            projectId={projectId}
            onSdkChange={setSdk}
            hideAnalysis
          />

          {flash && <div className="pointer-events-none absolute inset-0 z-30 animate-fade bg-white/70" />}

          <div className="absolute bottom-5 right-5 z-30 flex flex-col items-center gap-2">
            <button
              onClick={capture}
              disabled={!!busy || locked}
              title="Fotografar a vista atual (tecla F)"
              aria-label="Fotografar a vista atual"
              className="group relative grid h-16 w-16 place-items-center rounded-full bg-brand shadow-2xl ring-4 ring-white transition-[scale,background-color,box-shadow] duration-300 ease-out-expo hover:scale-105 hover:bg-action active:scale-95 disabled:pointer-events-none disabled:opacity-45"
            >
              <span className="pointer-events-none absolute -inset-2 rounded-full ring-1 ring-white/35 transition-transform duration-500 ease-out-expo group-hover:scale-110" />
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round">
                <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.2-2h8.2l1.2 2h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
                <circle cx="12" cy="13" r="3.6" />
              </svg>
              {activeStop && activeStop.photos.length > 0 && (
                <span
                  key={activeStop.photos.length}
                  className="absolute -right-1.5 -top-1.5 grid h-6 min-w-6 animate-pop place-items-center rounded-full bg-ink px-1.5 text-[11px] font-bold tabular text-white shadow-md ring-2 ring-white"
                >
                  {activeStop.photos.length}
                </span>
              )}
            </button>
            <span className={`max-w-40 truncate rounded-full px-2.5 py-1 text-center text-[11px] font-semibold shadow-2xl ${GLASS}`}>
              {busy === "foto" ? "capturando…" : activeStop ? activeStop.label : "1ª foto abre a frente"}
            </span>
          </div>
        </div>

        {/* caderno de campo */}
        <aside className="card flex min-h-0 flex-1 animate-rise flex-col overflow-hidden lg:w-[420px] lg:flex-none">
          <div className="shrink-0 border-b border-line-2 bg-white px-4 pb-4 pt-3.5">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h2 className="card-title">Roteiro da visita</h2>
              <Micro className="tabular">
                {stops.length} frente{stops.length === 1 ? "" : "s"} · {totalPhotos} foto
                {totalPhotos === 1 ? "" : "s"} · {totalIssues} NC{totalIssues === 1 ? "" : "s"}
              </Micro>
            </div>
            <div className="mb-3.5 flex gap-1">
              {Array.from({ length: planned }).map((_, i) => (
                <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/[0.07]">
                  {i < stops.length && (
                    <span className="block h-full origin-left animate-grow-x rounded-full bg-gradient-to-r from-[#38b6ff] to-action" />
                  )}
                </span>
              ))}
            </div>
            <button
              onClick={newFront}
              disabled={!!busy || locked}
              className="btn btn-secondary w-full"
            >
              <IconPlus className="h-4 w-4" />
              Abrir nova frente
            </button>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
              Fotografe quantas vistas quiser com o botão sobre o tour (ou a tecla{" "}
              <kbd className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-md bg-subtle px-1 font-mono text-[10.5px] font-semibold text-ink-2 ring-1 ring-inset ring-line">F</kbd>). Elas entram na frente ativa.
            </p>
            {error && (
              <p className="mt-2.5 animate-pop rounded-xl bg-[#fdeeec] px-3 py-2 text-[12px] leading-relaxed text-danger ring-1 ring-inset ring-[#f5d0cb]">
                {error}
              </p>
            )}
            {warning && (
              <p className="mt-2.5 animate-pop rounded-xl bg-[#fdf4e2] px-3 py-2 text-[12px] leading-relaxed text-warn ring-1 ring-inset ring-[#efdcb0]">
                {warning}
              </p>
            )}
            {composed && (
              <p className="mt-2.5 animate-pop rounded-xl bg-[#e8f6ed] px-3 py-2 text-[12px] leading-relaxed text-positive ring-1 ring-inset ring-[#c4e5d0]">
                Relatório composto com {totalPhotos} foto{totalPhotos === 1 ? "" : "s"}.{" "}
                <button
                  onClick={() => navigate(`${caminhoDaObra(projectId, "diario")}?rdo=${rdo.id}`)}
                  className="font-semibold underline underline-offset-2"
                >
                  Ver documento
                </button>
              </p>
            )}
          </div>

          {pendingAnchor && !locked && (
            <div className="max-h-[60%] shrink-0 overflow-y-auto border-b border-line-2">
              <NewIssueForm
                projectId={projectId}
                rdoId={rdo.id}
                levelId={activeStop?.levelId}
                initialEvidence={evidenciaDaFrente}
              />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto bg-subtle/40 p-3">
            {stops.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-8 text-center">
                <span className="mb-3.5 grid h-12 w-12 animate-float place-items-center rounded-2xl bg-gradient-to-b from-brand-soft to-white text-action ring-1 ring-inset ring-[#d4ebfb]">
                  <IconCamera className="h-5 w-5" />
                </span>
                <p className="max-w-xs text-[12.5px] leading-relaxed text-ink-2">
                  Navegue até a primeira frente de serviço e toque no{" "}
                  <b className="font-semibold text-ink">botão da câmera</b>. A primeira foto abre a
                  frente, e a IA redige a observação a partir dela.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {stops.map((stop, idx) => (
                  <StopCard
                    key={stop.id}
                    index={idx + 1}
                    stop={stop}
                    active={activeStop?.id === stop.id}
                    locked={!!locked}
                    issueTitles={issues.filter((i) => stop.issueIds.includes(i.id)).map((i) => i.title)}
                    onActivate={() => setActiveId(stop.id)}
                    onGo={goToPose}
                    onChange={(patch) => updateRdoStop(rdo.id, stop.id, patch)}
                    onRemove={() => removeRdoStop(rdo.id, stop.id)}
                    onPhotoChange={(photoId, patch) => updateRdoPhoto(rdo.id, stop.id, photoId, patch)}
                    onPhotoRemove={(photoId) => removeRdoPhoto(rdo.id, stop.id, photoId)}
                    onRedraft={() => observe(stop, stop.photos.map((p) => p.imageDataUrl))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* a cobrança acontece onde ela é verificável: em frente ao serviço */}
          {activeStop?.levelId && (
            <details className="group/nc shrink-0 border-t border-line-2 bg-white" open={ncAberto}>
              <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-subtle [&::-webkit-details-marker]:hidden">
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${ncAberto ? "bg-[#fdeeec] text-danger" : "bg-subtle text-ink-3"}`}>
                  <IconAlertTri className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1">Não conformidades desta frente</span>
                <span
                  className={`min-w-[22px] rounded-full px-1.5 py-px text-center text-[11px] font-bold tabular ${
                    ncAberto ? "bg-[#fdeeec] text-danger ring-1 ring-inset ring-[#f5d0cb]" : "bg-subtle text-ink-3"
                  }`}
                >
                  {pendentesDaFrente.length}
                </span>
                <IconChevronDown className="h-4 w-4 text-ink-3 transition-transform duration-300 group-open/nc:rotate-180" />
              </summary>
              <div className="max-h-[38vh] overflow-y-auto border-t border-line-2 px-3 py-3">
                {avisoNc && (
                  <p className="mb-2.5 flex animate-pop items-start gap-2 rounded-xl bg-brand-soft px-3 py-2 text-[11.5px] leading-relaxed text-action ring-1 ring-inset ring-[#cfe7fb]">
                    <span className="flex-1">{avisoNc}</span>
                    <button
                      onClick={() => setAvisoNc(null)}
                      className="shrink-0 rounded-md px-1.5 font-semibold text-action transition-colors hover:bg-white/70"
                    >
                      ok
                    </button>
                  </p>
                )}
                {pendentesDaFrente.length === 0 ? (
                  <p className="px-1 text-[12px] leading-relaxed text-ink-3">
                    Nenhuma não conformidade aberta neste pavimento. Marque uma no tour se encontrar algo.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {pendentesDaFrente.map((i, idx) => (
                      <div
                        key={i.id}
                        className="reveal rounded-xl bg-subtle p-3 ring-1 ring-inset ring-line-2"
                        style={{ ["--i" as string]: Math.min(idx, 12) }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[12.5px] font-semibold leading-snug text-ink">{i.title}</p>
                          <StatusChip status={i.status} nc={i.ncStatus} />
                        </div>
                        <Micro className="mt-0.5 block">{i.local} · {i.assignee}</Micro>
                        {!locked && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {(i.mp || i.pose) && (
                              <button
                                onClick={() => requestFlyTo(i.id)}
                                className="btn btn-secondary btn-sm h-7 px-2.5 text-[11.5px] text-action"
                              >
                                <IconCrosshair className="h-3.5 w-3.5" />
                                ver no tour
                              </button>
                            )}
                            {i.ncStatus === "reparo_submetido" ? (
                              <>
                                <button
                                  onClick={() => aprovarNaVisita(i)}
                                  className="btn btn-sm h-7 bg-[#e8f6ed] px-2.5 text-[11.5px] text-positive ring-1 ring-inset ring-[#c4e5d0] hover:ring-positive/50"
                                >
                                  verificada
                                </button>
                                <button
                                  onClick={() => setReprovando(reprovando === i.id ? null : i.id)}
                                  aria-expanded={reprovando === i.id}
                                  className="btn btn-sm h-7 bg-[#fdeeec] px-2.5 text-[11.5px] text-danger ring-1 ring-inset ring-[#f5d0cb] hover:ring-danger/50"
                                >
                                  reprovar
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => navigate(`${caminhoDaObra(projectId, "nao-conformidades")}?nc=${i.id}`)}
                                className="btn btn-secondary btn-sm h-7 px-2.5 text-[11.5px]"
                              >
                                abrir a peça
                                <IconArrowRight className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}

                        {reprovando === i.id && !locked && (
                          <div className="mt-2.5 animate-pop rounded-xl bg-white p-2.5 shadow-xs ring-1 ring-inset ring-line">
                            <textarea
                              rows={2}
                              autoFocus
                              value={motivo}
                              onChange={(e) => setMotivo(e.target.value)}
                              placeholder="Por que o reparo não foi aceito (obrigatório)"
                              className="field text-[12px]"
                            />
                            <div className="mt-2 flex gap-1.5">
                              <button
                                disabled={!motivo.trim()}
                                onClick={() => reprovarNaVisita(i)}
                                className="btn btn-primary btn-sm h-7 px-2.5 text-[11.5px]"
                              >
                                Registrar reprovação
                              </button>
                              <button
                                onClick={() => { setReprovando(null); setMotivo(""); }}
                                className="btn btn-ghost btn-sm h-7 px-2.5 text-[11.5px]"
                              >
                                cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          )}

          <details className="group/clima shrink-0 border-t border-line-2 bg-white">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-subtle [&::-webkit-details-marker]:hidden">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-action">
                <IconSun className="h-3.5 w-3.5" />
              </span>
              <span className="flex-1">Clima e efetivo</span>
              <IconChevronDown className="h-4 w-4 text-ink-3 transition-transform duration-300 group-open/clima:rotate-180" />
            </summary>
            <div className="max-h-[38vh] overflow-y-auto border-t border-line-2 px-4 py-3.5">
              <div className="mb-3.5 grid grid-cols-3 gap-2">
                {PERIODS.map((p) => (
                  <div key={p}>
                    <span className="label mb-1 block">{RDO_PERIOD_LABEL[p]}</span>
                    <select
                      value={rdo.weather[p]}
                      disabled={locked}
                      onChange={(e) =>
                        updateRdo(rdo.id, { weather: { ...rdo.weather, [p]: e.target.value as RdoWeather } })
                      }
                      className="field h-8 px-2 py-1 text-[12px]"
                    >
                      {(Object.keys(RDO_WEATHER_LABEL) as RdoWeather[]).map((w) => (
                        <option key={w} value={w}>{RDO_WEATHER_LABEL[w]}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {rdo.crew.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-line">
                  {rdo.crew.map((c, idx) => (
                    <div key={c.id} className={`flex items-center gap-2 px-3 py-1.5 ${idx > 0 ? "border-t border-line-2" : ""}`}>
                      <span className="flex-1 truncate text-[12.5px] text-ink-2">{c.role}</span>
                      <input
                        type="number"
                        min="0"
                        value={c.qty}
                        disabled={locked}
                        onChange={(e) =>
                          updateRdo(rdo.id, {
                            crew: rdo.crew.map((x) =>
                              x.id === c.id ? { ...x, qty: Math.max(0, parseInt(e.target.value || "0", 10)) } : x,
                            ),
                          })
                        }
                        className="field h-8 w-16 px-2 py-1 text-center text-[12.5px] tabular"
                      />
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2.5 text-[11.5px] text-ink-3">
                Os demais campos ficam no editor completo do RDO.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}

function StopCard({
  index, stop, active, locked, issueTitles,
  onActivate, onGo, onChange, onRemove, onPhotoChange, onPhotoRemove, onRedraft,
}: {
  index: number;
  stop: RdoStop;
  active: boolean;
  locked: boolean;
  issueTitles: string[];
  onActivate: () => void;
  onGo: (pose?: { sweep: string; rotation: { x: number; y: number } }) => void;
  onChange: (patch: Partial<RdoStop>) => void;
  onRemove: () => void;
  onPhotoChange: (photoId: string, patch: Partial<RdoPhoto>) => void;
  onPhotoRemove: (photoId: string) => void;
  onRedraft: () => void;
}) {
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);
  const selected = stop.photos.find((p) => p.id === openPhoto) ?? null;

  return (
    <div
      onClick={onActivate}
      className={`reveal cursor-pointer rounded-2xl border p-3.5 transition-[border-color,box-shadow,background-color] duration-300 ease-out-expo ${
        active
          ? "border-brand/45 bg-white shadow-md ring-4 ring-brand/[0.08]"
          : "border-line/80 bg-white shadow-xs hover:border-field hover:shadow-sm"
      }`}
      style={{ ["--i" as string]: Math.min(index - 1, 12) }}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11.5px] font-bold tabular transition-colors duration-300 ${
            active
              ? "bg-gradient-to-b from-[#2bb0ff] to-action text-white shadow-[0_4px_10px_-3px_rgb(0_155_255/0.6)]"
              : "bg-subtle text-ink-2 ring-1 ring-inset ring-line"
          }`}
        >
          {String(index).padStart(2, "0")}
        </span>
        <input
          value={stop.label}
          disabled={locked}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ label: e.target.value })}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-[13.5px] font-semibold tracking-[-0.01em] text-ink transition-[border-color,box-shadow,background-color] duration-200 hover:border-line hover:bg-white focus:border-brand focus:bg-white focus:shadow-[0_0_0_4px_rgb(0_155_255/0.12)] focus:outline-none"
        />
        {active && (
          <span className="inline-flex shrink-0 animate-pop items-center gap-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-semibold text-action ring-1 ring-inset ring-[#cfe7fb]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-brand opacity-70" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-brand" />
            </span>
            fotografando
          </span>
        )}
        {!locked && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            aria-label={`Remover ${stop.label}`}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* fita de fotos da frente */}
      {stop.photos.length === 0 ? (
        <p className="mb-2.5 flex items-center gap-2 rounded-xl border-2 border-dashed border-line px-3 py-2.5 text-[11.5px] text-ink-3">
          <IconCamera className="h-4 w-4 shrink-0" />
          Sem fotos nesta frente — use o botão da câmera sobre o tour.
        </p>
      ) : (
        <div className="-mx-0.5 mb-2.5 flex gap-2 overflow-x-auto px-0.5 pb-1 pt-0.5">
          {stop.photos.map((p, i) => (
            <button
              key={p.id}
              onClick={(e) => { e.stopPropagation(); setOpenPhoto(openPhoto === p.id ? null : p.id); }}
              aria-pressed={openPhoto === p.id}
              className={`group relative shrink-0 animate-pop overflow-hidden rounded-xl transition-[box-shadow,translate] duration-300 ease-out-expo hover:-translate-y-0.5 hover:shadow-md ${
                openPhoto === p.id ? "ring-2 ring-brand ring-offset-1" : "ring-1 ring-line"
              }`}
            >
              <img
                src={p.imageDataUrl}
                alt=""
                className="h-14 w-20 object-cover transition-transform duration-500 ease-out-expo group-hover:scale-110"
              />
              <span className={`absolute left-1 top-1 grid h-4 min-w-4 place-items-center rounded-md px-1 text-[9.5px] font-bold tabular ${GLASS}`}>
                {i + 1}
              </span>
              {p.kind !== "panoramica" && (
                <span className="absolute inset-x-0 bottom-0 truncate bg-[linear-gradient(0deg,rgb(8_20_32/0.8),transparent)] px-1 pb-0.5 pt-2 text-center text-[9px] font-semibold text-white">
                  {RDO_PHOTO_KIND_LABEL[p.kind].slice(0, 12)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* editor da foto selecionada */}
      {selected && (
        <div
          className="mb-2.5 animate-pop rounded-xl bg-subtle p-2.5 ring-1 ring-inset ring-line-2"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            value={selected.caption}
            disabled={locked}
            placeholder="Legenda da foto (entra no anexo do RDO)"
            onChange={(e) => onPhotoChange(selected.id, { caption: e.target.value })}
            className="field mb-2.5 h-8 py-1 text-[12.5px]"
          />
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k}
                disabled={locked}
                aria-pressed={selected.kind === k}
                onClick={() => onPhotoChange(selected.id, { kind: k })}
                className={`rounded-full px-2.5 py-[3px] text-[10.5px] font-semibold ring-1 ring-inset transition-[color,background-color,box-shadow] duration-200 disabled:opacity-60 ${
                  selected.kind === k ? KIND_CHIP[k] : "bg-white text-ink-3 ring-line hover:text-ink hover:ring-field"
                }`}
              >
                {RDO_PHOTO_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {selected.pose && (
              <button
                onClick={() => onGo(selected.pose)}
                className="btn btn-ghost btn-sm -ml-1.5 h-7 px-2 text-[11.5px] text-action hover:bg-brand-soft"
              >
                <IconRotate360 className="h-3.5 w-3.5" />
                ir ao ponto desta foto
              </button>
            )}
            {!locked && (
              <button
                onClick={() => { onPhotoRemove(selected.id); setOpenPhoto(null); }}
                className="btn btn-ghost btn-sm -mr-1.5 ml-auto h-7 px-2 text-[11.5px] text-danger hover:bg-danger/10"
              >
                <IconTrash className="h-3.5 w-3.5" />
                excluir foto
              </button>
            )}
          </div>
        </div>
      )}

      <div className="relative">
        <textarea
          rows={4}
          value={stop.observation}
          disabled={locked}
          placeholder={stop.aiStatus === "analisando" ? "Redigindo a observação…" : "Observação desta frente"}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ observation: e.target.value })}
          className={`field text-[12.5px] leading-relaxed ${stop.aiStatus === "analisando" ? "border-brand/40 bg-brand-soft/30" : ""}`}
        />
        {stop.aiStatus === "analisando" && (
          <span className="pointer-events-none absolute bottom-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-white text-action shadow-sm ring-1 ring-inset ring-[#cfe7fb]">
            <IconSpark className="h-3.5 w-3.5 animate-pulse" />
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Micro>
          {new Date(stop.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          {stop.aiStatus === "analisando" && " · lendo as fotos…"}
          {stop.aiStatus === "erro" && " · falha na leitura"}
          {stop.aiSimulated && " · simulada"}
        </Micro>
        {!locked && stop.photos.length > 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); onRedraft(); }}
            className="btn btn-ghost btn-sm ml-auto h-7 px-2 text-[11.5px] text-action hover:bg-brand-soft"
          >
            <IconSpark className="h-3.5 w-3.5" />
            redigir com as {stop.photos.length} fotos
          </button>
        )}
      </div>

      {issueTitles.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {issueTitles.map((t) => (
            <li
              key={t}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-subtle px-2.5 py-1 text-[11.5px] font-medium text-ink-2 ring-1 ring-inset ring-line-2"
            >
              <IconCrosshair className="h-3 w-3 shrink-0 text-action" />
              <span className="truncate">{t}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
