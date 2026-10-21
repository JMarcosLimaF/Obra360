import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { levelsOf } from "../data/catalog";
import { caminhoDaObra } from "../obra";
import { useApp } from "../store";
import type { FloorplanPin } from "../types";
import { mpState } from "./MatterportViewer";
import { IconArrowRight, IconChevronDown, IconClose, IconCrosshair, IconLayers } from "./ui";

/* vidro escuro sobre o tour — ver DESIGN.md */
const GLASS = "rounded-2xl bg-[rgb(8_20_32/0.62)] text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl";

/**
 * A planta dentro do tour — a ponte entre "o que deveria existir" e "o que existe".
 *
 * Sem backend não há alinhamento automático entre a nuvem de pontos e o desenho,
 * e fingir que há seria pior do que não ter. Então o vínculo é feito por quem
 * está na obra: você está numa vista do tour, aponta no desenho onde está, e o
 * ponto guarda **essa vista**. Do desenho, um clique traz a câmera de volta.
 * Um ponto de cada vez, a planta vira o índice de navegação do 360.
 */
export default function PlanMini({ projectId }: { projectId: string }) {
  const floorplans = useApp((s) => s.floorplans).filter((f) => f.projectId === projectId);
  const addPin = useApp((s) => s.addFloorplanPin);
  const issues = useApp((s) => s.issues);
  const requestFlyToPose = useApp((s) => s.requestFlyToPose);
  const requestFlyTo = useApp((s) => s.requestFlyTo);
  const levels = useMemo(() => levelsOf(projectId), [projectId]);

  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<number>();

  const plan = floorplans.find((f) => f.id === planId) ?? floorplans[0] ?? null;

  useEffect(() => {
    if (plan && planId !== plan.id) setPlanId(plan.id);
  }, [plan, planId]);

  useEffect(() => () => window.clearTimeout(noteTimer.current), []);

  const flash = (msg: string) => {
    setNote(msg);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 3200);
  };

  /** Marca no desenho o lugar de onde a câmera está olhando agora. */
  const linkHere = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!plan || !linking) return;
    const rect = e.currentTarget.getBoundingClientRect();
    let pose: FloorplanPin["pose"];
    try {
      const p = await mpState.sdk?.Camera.getPose();
      if (p?.sweep) pose = { sweep: p.sweep, rotation: p.rotation };
    } catch { /* tour desconectado */ }

    if (!pose) {
      flash("O tour ainda não está conectado — sem vista para guardar neste ponto.");
      setLinking(false);
      return;
    }
    const pin: FloorplanPin = {
      id: `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      label: `Ponto ${plan.pins.length + 1}`,
      note: "",
      pose,
      createdAt: new Date().toISOString(),
    };
    addPin(plan.id, pin);
    setLinking(false);
    flash(`${pin.label} guardou esta vista. Um clique nele traz a câmera de volta.`);
  };

  const goToPin = (pin: FloorplanPin) => {
    const issue = issues.find((i) => i.id === pin.issueId);
    if (issue && (issue.tagId || issue.mp)) {
      requestFlyTo(issue.id);
      flash(`Indo à não conformidade "${issue.title}".`);
      return;
    }
    if (pin.pose) {
      requestFlyToPose(pin.pose);
      flash(`Voltando à vista de ${pin.label}.`);
      return;
    }
    flash(`${pin.label} não tem vista guardada. Use "vincular vista" estando no lugar.`);
  };

  if (floorplans.length === 0) {
    return (
      <div className={`absolute bottom-4 left-4 z-20 flex max-w-[260px] animate-pop items-start gap-3 p-3.5 ${GLASS}`}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 text-white/80 ring-1 ring-inset ring-white/10">
          <IconLayers className="h-4 w-4" />
        </span>
        <p className="text-[11.5px] leading-relaxed text-white/75">
          Nenhuma planta carregada nesta obra.{" "}
          <Link
            to={`${caminhoDaObra(projectId, "plantas")}`}
            className="font-semibold text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            Carregar pranchas
          </Link>{" "}
          para navegar o tour pelo desenho.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`absolute bottom-4 left-4 z-20 flex h-10 animate-pop items-center gap-2 px-3.5 text-[12.5px] font-semibold transition-colors duration-200 hover:bg-[rgb(8_20_32/0.78)] ${GLASS}`}
      >
        <IconLayers className="h-4 w-4 text-white/80" />
        Planta
        {plan && plan.pins.length > 0 && (
          <span className="min-w-[20px] rounded-full bg-white/15 px-1.5 py-px text-center text-[11px] font-bold tabular text-white/85">
            {plan.pins.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={`absolute bottom-4 left-4 z-20 w-[300px] max-w-[calc(100%-2rem)] origin-bottom-left animate-pop overflow-hidden ${GLASS}`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/10 text-white/80">
          <IconLayers className="h-3.5 w-3.5" />
        </span>
        <span className="relative min-w-0 flex-1">
          <select
            value={plan?.id ?? ""}
            onChange={(e) => setPlanId(e.target.value)}
            aria-label="Prancha"
            className="w-full cursor-pointer appearance-none truncate rounded-lg bg-transparent py-1 pl-1.5 pr-6 text-[12.5px] font-semibold text-white transition-colors hover:bg-white/10 focus:bg-white/10 focus:outline-none"
          >
            {floorplans.map((f) => (
              <option key={f.id} value={f.id} className="text-ink">
                {f.name}
                {f.levelId ? ` — ${levels.find((l) => l.id === f.levelId)?.name ?? ""}` : ""}
              </option>
            ))}
          </select>
          <IconChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/55" />
        </span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Fechar planta"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <IconClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {plan && (
        <div
          onClick={linkHere}
          className={`relative mx-2 rounded-xl bg-white ${linking ? "cursor-crosshair" : ""}`}
        >
          <img src={plan.imageSrc} alt={`Planta ${plan.name}`} className="block w-full rounded-xl" />
          {linking && (
            <span className="pointer-events-none absolute inset-0 animate-fade rounded-xl ring-2 ring-inset ring-brand shadow-[inset_0_0_24px_rgb(0_155_255/0.25)]" />
          )}
          {plan.pins.map((pin, i) => {
            const issue = issues.find((x) => x.id === pin.issueId);
            const color = issue
              ? issue.status === "resolvido" ? "bg-positive" : "bg-danger"
              : pin.pose ? "bg-action" : "bg-ink-3";
            return (
              <button
                key={pin.id}
                onClick={(e) => { e.stopPropagation(); goToPin(pin); }}
                title={`${pin.label}${pin.pose ? " — ir a esta vista" : " — sem vista guardada"}`}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
              >
                <span className={`grid h-5 w-5 place-items-center rounded-full border-2 border-white text-[9.5px] font-bold text-white shadow-md transition-transform duration-200 hover:scale-125 ${color}`}>
                  {i + 1}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2 px-2 py-2">
        <button
          onClick={() => setLinking((v) => !v)}
          className={`flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[11.5px] font-semibold transition-colors duration-200 ${
            linking
              ? "bg-brand text-white shadow-[0_6px_16px_-6px_rgb(0_155_255/0.7)]"
              : "text-white/80 ring-1 ring-inset ring-white/15 hover:bg-white/10 hover:text-white"
          }`}
        >
          <IconCrosshair className="h-3.5 w-3.5" />
          {linking ? "Clique no desenho" : "Vincular vista"}
        </button>
        <Link
          to={`${caminhoDaObra(projectId, "plantas")}`}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-[11.5px] font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          Abrir plantas
          <IconArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {note && (
        <p key={note} className="mx-2 mb-2 animate-fade rounded-xl bg-white/[0.07] px-3 py-2 text-[11.5px] leading-relaxed text-white/85 ring-1 ring-inset ring-white/10">
          {note}
        </p>
      )}
      {!note && plan && plan.pins.length === 0 && (
        <p className="px-3 pb-3 text-[11.5px] font-medium leading-relaxed text-white/55">
          Ande até um lugar reconhecível e use "vincular vista".
        </p>
      )}
    </div>
  );
}
