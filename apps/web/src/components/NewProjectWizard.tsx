import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { fmtDate } from "../data/catalog";
import { fileToDataUrl } from "../lib/image";
import { thumbUrl } from "../lib/matterport";
import { cnpjValido, fmtBrl, maskBrl, maskCnpj, parseBrl } from "../lib/br";
import {
  emptyDraft,
  extractMatterportId,
  generateLevels,
  levelKey,
  matterportValido,
  toPayload,
  validateStep,
  type ContractorMode,
  type ProjectDraft,
  type StepErrors,
} from "../lib/new-project";
import { caminhoDaObra } from "../obra";
import { useApp } from "../store";
import type { IssueSeverity, Project } from "../types";
import { projectInitials } from "./ProjectThumb";
import {
  IconArrowRight,
  IconBriefcase,
  IconBuilding,
  IconCamera,
  IconCheck,
  IconClose,
  IconFileText,
  IconLayers,
  IconMapPin,
  IconPlus,
  IconRotate360,
  IconShield,
  IconSpark,
  LogoMark,
} from "./ui";

const STEPS = [
  { title: "Dados da obra", hint: "Nome, órgão e prazos", icon: IconBuilding },
  { title: "Pavimentos", hint: "Como a obra se divide", icon: IconLayers },
  { title: "Contratada", hint: "Quem executa", icon: IconBriefcase },
  { title: "Contrato", hint: "Vigência, valor e prazos", icon: IconFileText },
  { title: "Foto e tour 360", hint: "Capa e modelo Matterport", icon: IconCamera },
  { title: "Revisão", hint: "Conferir e cadastrar", icon: IconCheck },
] as const;

const DESCRIPTIONS = [
  "Comece pela identificação. O nome aparece na lista de obras e no endereço da página.",
  "Os pavimentos organizam plantas, capturas 360, visitas e não conformidades.",
  "A contratada é quem recebe as notificações de não conformidade.",
  "O contrato dá força às notificações e define os prazos de reparo por severidade.",
  "Opcional. A foto vira a capa da obra; o modelo Matterport habilita o Tour 360.",
  "Confira tudo antes de cadastrar. Você pode voltar a qualquer etapa.",
];

const SEVERIDADES: { key: IssueSeverity; label: string; tone: string }[] = [
  { key: "critica", label: "Crítica", tone: "bg-[#fdeeec] text-danger ring-[#f5d0cb]" },
  { key: "alta", label: "Alta", tone: "bg-[#fdf4e2] text-warn ring-[#efdcb0]" },
  { key: "media", label: "Média", tone: "bg-brand-soft text-action ring-[#cfe7fb]" },
  { key: "baixa", label: "Baixa", tone: "bg-subtle text-ink-2 ring-line" },
];

const LAST = STEPS.length - 1;

/** Etapas deslizam para o lado em que se anda. */
const SLIDE = {
  enter: (d: number) => ({ opacity: 0, x: d * 28 }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: d * -28 }),
};

/** Assistente de cadastro de obra, em etapas, sobre a lista de obras. */
export default function NewProjectWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  return createPortal(
    <AnimatePresence>
      {open && <WizardDialog key="wizard" onClose={onClose} />}
    </AnimatePresence>,
    document.body,
  );
}

function WizardDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const projects = useApp((s) => s.projects);
  const contractors = useApp((s) => s.contractors);
  const user = useApp((s) => s.user);
  const canCreate = useApp((s) => s.activeRole === "gestor");
  const createProject = useApp((s) => s.createProject);

  const [draft, setDraft] = useState<ProjectDraft>(() => {
    const d = emptyDraft();
    d.contract.gestorDesignado = user ?? "";
    return d;
  });
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [reached, setReached] = useState(0);
  const [tried, setTried] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [created, setCreated] = useState<Project | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const existingNames = useMemo(() => projects.map((p) => p.name), [projects]);
  const errors = validateStep(step, draft, existingNames);
  const shownErrors: StepErrors = tried[step] ? errors : {};
  const dirty = draft.name.trim() !== "" || draft.client.trim() !== "" || draft.cover !== "" || step > 0;

  // sem contratada cadastrada, "já cadastrada" não tem o que escolher
  useEffect(() => {
    if (contractors.length === 0 && draft.contractorMode === "existente") {
      setDraft((d) => ({ ...d, contractorMode: "nova" }));
    }
  }, [contractors.length, draft.contractorMode]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function requestClose() {
    if (saving) return;
    if (dirty && !created) setConfirmClose(true);
    else onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmClose) setConfirmClose(false);
      else requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function update(patch: Partial<ProjectDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setApiError(null);
  }

  function goTo(target: number) {
    if (target === step) return;
    setDir(target > step ? 1 : -1);
    setStep(target);
    bodyRef.current?.scrollTo({ top: 0 });
  }

  function next() {
    if (Object.keys(errors).length) {
      setTried((t) => ({ ...t, [step]: true }));
      return;
    }
    if (step === LAST) {
      void submit();
      return;
    }
    const target = step + 1;
    setReached((r) => Math.max(r, target));
    goTo(target);
  }

  async function submit() {
    // revalida tudo: uma etapa pode ter ficado inválida ao editar outra
    for (let i = 0; i < LAST; i++) {
      if (Object.keys(validateStep(i, draft, existingNames)).length) {
        setTried((t) => ({ ...t, [i]: true }));
        goTo(i);
        return;
      }
    }
    setSaving(true);
    setApiError(null);
    const res = await createProject(toPayload(draft, draft.cover || undefined));
    setSaving(false);
    if (res.error) setApiError(res.error);
    else if (res.project) {
      setWarnings(res.warnings ?? []);
      setCreated(res.project);
    }
  }

  function restart() {
    const d = emptyDraft();
    d.contract.gestorDesignado = user ?? "";
    setDraft(d);
    setStep(0);
    setReached(0);
    setTried({});
    setCreated(null);
    setWarnings([]);
    setApiError(null);
  }

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-navy-950/50 backdrop-blur-[6px] sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Cadastrar nova obra"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        className="relative flex h-full w-full overflow-hidden bg-white shadow-2xl sm:h-[min(780px,94vh)] sm:max-w-[1080px] sm:rounded-[28px]"
      >
        <Rail
          step={created ? STEPS.length : step}
          reached={created ? STEPS.length : reached}
          draft={draft}
          onPick={(i) => {
            if (!created && i <= reached) goTo(i);
          }}
        />

        <section className="relative flex min-w-0 flex-1 flex-col">
          {created ? (
            <Success
              project={created}
              levels={draft.levels.length}
              warnings={warnings}
              onOpen={() => {
                onClose();
                navigate(caminhoDaObra(created.id));
              }}
              onAnother={restart}
              onClose={onClose}
            />
          ) : !canCreate ? (
            <Locked onClose={onClose} />
          ) : (
            <>
              {/* cabeçalho */}
              <div className="flex shrink-0 items-start gap-4 border-b border-line-2 px-5 pb-4 pt-5 sm:px-8 sm:pt-6">
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-[12px] font-semibold text-brand">
                    Etapa {step + 1} de {STEPS.length}
                  </p>
                  <h2 className="font-display text-[22px] font-bold tracking-[-0.025em] text-ink">{STEPS[step].title}</h2>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{DESCRIPTIONS[step]}</p>
                </div>
                <button
                  type="button"
                  onClick={requestClose}
                  aria-label="Fechar"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-3 transition hover:bg-subtle hover:text-ink"
                >
                  <IconClose className="h-[18px] w-[18px]" />
                </button>
              </div>
              {/* progresso no mobile */}
              <div className="flex gap-1 px-5 pt-3 md:hidden">
                {STEPS.map((s, i) => (
                  <span key={s.title} className={`h-1 flex-1 rounded-full transition-colors duration-500 ${i <= step ? "bg-brand" : "bg-ink/[0.08]"}`} />
                ))}
              </div>

              <form
                className="flex min-h-0 flex-1 flex-col"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  next();
                }}
              >
                <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-6 sm:px-8">
                  <AnimatePresence mode="wait" custom={dir} initial={false}>
                    <motion.div
                      key={step}
                      custom={dir}
                      variants={SLIDE}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                    >
                      {step === 0 && <StepDados draft={draft} update={update} errors={shownErrors} projects={projects} />}
                      {step === 1 && <StepPavimentos draft={draft} update={update} errors={shownErrors} />}
                      {step === 2 && <StepContratada draft={draft} update={update} errors={shownErrors} />}
                      {step === 3 && <StepContrato draft={draft} update={update} errors={shownErrors} />}
                      {step === 4 && <StepMidia draft={draft} update={update} errors={shownErrors} />}
                      {step === 5 && <StepRevisao draft={draft} onEdit={goTo} />}
                    </motion.div>
                  </AnimatePresence>
                </div>

                {apiError && (
                  <div className="mx-5 mb-3 flex items-start gap-2.5 rounded-xl bg-[#fdeeec] px-3.5 py-2.5 text-[12.5px] font-medium text-danger ring-1 ring-inset ring-[#f5d0cb] animate-pop sm:mx-8">
                    <IconShield className="mt-px h-4 w-4 shrink-0" />
                    {apiError}
                  </div>
                )}

                {/* rodapé */}
                <div className="flex shrink-0 items-center gap-3 border-t border-line-2 bg-subtle/60 px-5 py-3.5 sm:px-8">
                  <button
                    type="button"
                    onClick={() => (step === 0 ? requestClose() : goTo(step - 1))}
                    className="btn btn-ghost"
                    disabled={saving}
                  >
                    {step === 0 ? "Cancelar" : "Voltar"}
                  </button>
                  <span className="ml-auto hidden text-[12px] text-ink-3 sm:block">
                    {Object.keys(shownErrors).length > 0 ? (
                      <span className="font-medium text-danger">Revise os campos destacados</span>
                    ) : step < LAST ? (
                      <>
                        Próximo: <b className="font-semibold text-ink-2">{STEPS[step + 1].title}</b>
                      </>
                    ) : (
                      "Tudo pronto"
                    )}
                  </span>
                  <button
                    type="submit"
                    disabled={saving}
                    className={`btn btn-lg ml-auto min-w-[150px] sm:ml-0 ${step === LAST ? "btn-accent" : "btn-primary"}`}
                  >
                    {saving ? (
                      <>
                        <Spinner /> Cadastrando…
                      </>
                    ) : step === LAST ? (
                      <>
                        <IconCheck className="h-[17px] w-[17px]" /> Cadastrar obra
                      </>
                    ) : (
                      <>
                        Continuar <IconArrowRight className="h-[17px] w-[17px]" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </>
          )}

          <AnimatePresence>
            {confirmClose && (
              <motion.div
                className="absolute inset-0 z-20 grid place-items-center bg-white/70 p-6 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  initial={{ scale: 0.95, y: 8 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.95, y: 8 }}
                  className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-xl ring-1 ring-line"
                >
                  <p className="text-[15px] font-bold text-ink">Descartar o cadastro?</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
                    O que você preencheu até aqui será perdido.
                  </p>
                  <div className="mt-5 flex justify-center gap-2">
                    <button type="button" className="btn btn-secondary" onClick={() => setConfirmClose(false)}>
                      Continuar editando
                    </button>
                    <button type="button" className="btn btn-danger" onClick={onClose}>
                      Descartar
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </motion.div>
    </motion.div>
  );
}

/* ───────────────────────── trilho lateral ───────────────────────── */

function Rail({ step, reached, draft, onPick }: { step: number; reached: number; draft: ProjectDraft; onPick: (i: number) => void }) {
  return (
    <aside className="relative hidden w-[290px] shrink-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#0e3656_0%,#0a2540_60%,#071d33_100%)] p-6 text-white md:flex">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] bg-[size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_320px)]" />
      <div className="pointer-events-none absolute -bottom-20 -right-16 h-64 w-64 animate-float rounded-full bg-brand/25 blur-3xl" />

      <div className="relative flex items-center gap-3">
        <LogoMark className="h-9 w-9" />
        <div>
          <p className="text-[15px] font-bold leading-tight">Nova obra</p>
          <p className="text-[11.5px] text-white/50">Cadastro em {STEPS.length} etapas</p>
        </div>
      </div>

      <ol className="relative mt-8 flex flex-col">
        {STEPS.map((s, i) => {
          const done = i !== step && (i < step || i < reached);
          const active = i === step;
          const clickable = i <= reached && !active;
          return (
            <li key={s.title} className="relative">
              {i < STEPS.length - 1 && (
                <span className="absolute left-[17px] top-10 h-[calc(100%-28px)] w-px bg-white/10">
                  <span
                    className="block w-px bg-brand transition-[height] duration-500 ease-out-expo"
                    style={{ height: i < step ? "100%" : "0%" }}
                  />
                </span>
              )}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onPick(i)}
                className={`group flex w-full items-start gap-3.5 rounded-2xl py-2 pr-2 text-left transition ${clickable ? "cursor-pointer" : "cursor-default"}`}
              >
                <span
                  className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[13px] font-bold transition-all duration-300 ${
                    active
                      ? "bg-brand text-white shadow-[0_0_0_4px_rgb(0_155_255/0.2),0_8px_20px_-6px_rgb(0_155_255/0.8)]"
                      : done
                        ? "bg-white/15 text-white"
                        : "bg-white/[0.06] text-white/40 ring-1 ring-inset ring-white/10"
                  } ${clickable ? "group-hover:bg-white/25" : ""}`}
                >
                  {done && !active ? <IconCheck className="h-4 w-4" /> : i + 1}
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className={`block text-[13px] font-semibold ${active ? "text-white" : done ? "text-white/80" : "text-white/45"}`}>
                    {s.title}
                  </span>
                  <span className={`block text-[11.5px] ${active ? "text-white/60" : "text-white/35"}`}>{s.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* prévia viva do card */}
      <div className="relative mt-auto overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-inset ring-white/10">
        <div className="relative h-24 overflow-hidden bg-[linear-gradient(160deg,#1b5c8f,#0a2540)]">
          {draft.cover ? (
            <img src={draft.cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : matterportValido(extractMatterportId(draft.matterport)) ? (
            <img src={thumbUrl(extractMatterportId(draft.matterport))} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-[22px] font-bold text-white/25">
              {draft.name.trim() ? projectInitials(draft.name) : <IconBuilding className="h-8 w-8" />}
            </span>
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,rgb(6_26_46/0.85))]" />
          <p className="absolute inset-x-3 bottom-2 truncate text-[13px] font-bold">{draft.name.trim() || "Nome da obra"}</p>
        </div>
        <div className="space-y-1 px-3 py-2.5 text-[11.5px] text-white/55">
          <p className="truncate">{draft.client.trim() || "Órgão contratante"}</p>
          <p className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <IconLayers className="h-3.5 w-3.5" /> {draft.levels.length}
            </span>
            <span className="whitespace-nowrap">{draft.progressPct}%</span>
            {draft.endsAt && <span className="truncate whitespace-nowrap">entrega {fmtDate(draft.endsAt)}</span>}
          </p>
        </div>
      </div>
    </aside>
  );
}

/* ───────────────────────── campos ───────────────────────── */

function Field({
  label,
  required,
  error,
  hint,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold text-ink-2">
        {label}
        {required && <span className="text-brand">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1.5 block animate-pop text-[11.5px] font-medium text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[11.5px] text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

const inputCls = (error?: string) =>
  `field h-11 ${error ? "border-danger/60 focus:border-danger focus:shadow-[0_0_0_4px_rgb(194_58_47/0.12)]" : ""}`;

type StepProps = { draft: ProjectDraft; update: (p: Partial<ProjectDraft>) => void; errors: StepErrors };

/* ───────────────────────── etapa 1: dados ───────────────────────── */

function StepDados({ draft, update, errors, projects }: StepProps & { projects: Project[] }) {
  const clients = [...new Set(projects.map((p) => p.client).filter(Boolean))];
  const meses =
    draft.startsAt && draft.endsAt && draft.endsAt >= draft.startsAt
      ? Math.max(1, Math.round((new Date(draft.endsAt).getTime() - new Date(draft.startsAt).getTime()) / (30.44 * 864e5)))
      : null;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field
        label="Nome da obra"
        required
        error={errors.name}
        hint={
          <span>
            Endereço: <span className="font-mono text-[11px] text-ink-2">/obras/{draft.name.trim() || "nome-da-obra"}</span>
          </span>
        }
        className="sm:col-span-2"
      >
        <input
          autoFocus
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Ex.: Escola Municipal Jardim das Flores"
          className={`${inputCls(errors.name)} h-12 text-[15px] font-semibold`}
          maxLength={120}
        />
      </Field>
      <Field label="Órgão contratante ou cliente" required error={errors.client} className="sm:col-span-2">
        <input
          value={draft.client}
          onChange={(e) => update({ client: e.target.value })}
          placeholder="Ex.: Secretaria Municipal de Infraestrutura — SEMINFRA"
          className={inputCls(errors.client)}
          list="np-clients"
        />
        <datalist id="np-clients">
          {clients.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="Endereço da obra" className="sm:col-span-2">
        <span className="relative block">
          <IconMapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            value={draft.address}
            onChange={(e) => update({ address: e.target.value })}
            placeholder="Rua, número — bairro, cidade/UF"
            className={`${inputCls()} pl-10`}
          />
        </span>
      </Field>
      <Field label="Início da obra">
        <input type="date" value={draft.startsAt} onChange={(e) => update({ startsAt: e.target.value })} className={inputCls()} />
      </Field>
      <Field
        label="Entrega prevista"
        required
        error={errors.endsAt}
        hint={meses ? `≈ ${meses} ${meses === 1 ? "mês" : "meses"} de execução` : undefined}
      >
        <input
          type="date"
          value={draft.endsAt}
          min={draft.startsAt || undefined}
          onChange={(e) => update({ endsAt: e.target.value })}
          className={inputCls(errors.endsAt)}
        />
      </Field>
      <div className="rounded-2xl bg-subtle p-4 ring-1 ring-inset ring-line-2 sm:col-span-2">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-[12px] font-semibold text-ink-2">Avanço físico atual</span>
          <span className="font-display text-[22px] font-bold tabular text-ink">{draft.progressPct}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={draft.progressPct}
          onChange={(e) => update({ progressPct: Number(e.target.value) })}
          aria-label="Avanço físico atual"
          className="h-2 w-full cursor-pointer appearance-none rounded-full accent-[#009bff]"
          style={{
            background: `linear-gradient(90deg, #38b6ff 0%, #0a72d1 ${draft.progressPct}%, rgb(14 54 86 / 0.1) ${draft.progressPct}%)`,
          }}
        />
        <p className="mt-2 text-[11.5px] text-ink-3">Deixe em 0% para obra que ainda vai começar.</p>
      </div>
    </div>
  );
}

/* ───────────────────────── etapa 2: pavimentos ───────────────────────── */

function StepPavimentos({ draft, update, errors }: StepProps) {
  const [gen, setGen] = useState({ subsolos: 0, terreo: true, acima: 2, cobertura: true });
  const levels = draft.levels;
  const setLevels = (l: ProjectDraft["levels"]) => update({ levels: l });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= levels.length) return;
    const copy = [...levels];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    setLevels(copy);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_210px]">
      <div className="min-w-0 space-y-5">
        {/* gerador */}
        <div className="rounded-2xl bg-[linear-gradient(140deg,#eef7ff_0%,#ffffff_70%)] p-4 ring-1 ring-inset ring-[#d6eafb]">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#38b6ff] to-action text-white">
              <IconSpark className="h-3.5 w-3.5" />
            </span>
            <p className="text-[13px] font-semibold text-ink">Gerar a lista automaticamente</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stepper label="Subsolos" value={gen.subsolos} min={0} max={6} onChange={(v) => setGen({ ...gen, subsolos: v })} />
            <Toggle label="Térreo" checked={gen.terreo} onChange={(v) => setGen({ ...gen, terreo: v })} />
            <Stepper label="Andares acima" value={gen.acima} min={0} max={60} onChange={(v) => setGen({ ...gen, acima: v })} />
            <Toggle label="Cobertura" checked={gen.cobertura} onChange={(v) => setGen({ ...gen, cobertura: v })} />
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-3"
            onClick={() => setLevels(generateLevels(gen).map((name) => ({ key: levelKey(), name })))}
          >
            <IconLayers className="h-3.5 w-3.5" />
            Gerar {generateLevels(gen).length} pavimento{generateLevels(gen).length === 1 ? "" : "s"}
          </button>
        </div>

        {/* lista */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12px] font-semibold text-ink-2">
              Pavimentos <span className="text-ink-3">· de baixo para cima</span>
            </p>
            <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-bold tabular text-ink-2">{levels.length}</span>
          </div>
          <div className="relative space-y-2">
            <AnimatePresence initial={false} mode="popLayout">
              {levels.map((l, i) => (
                <motion.div
                  key={l.key}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  className="flex items-center gap-2 rounded-xl bg-white p-1.5 pl-2 ring-1 ring-line transition-shadow focus-within:ring-brand/60"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink/[0.05] text-[11.5px] font-bold tabular text-ink-2">
                    {i + 1}
                  </span>
                  <input
                    value={l.name}
                    onChange={(e) => setLevels(levels.map((x) => (x.key === l.key ? { ...x, name: e.target.value } : x)))}
                    placeholder="Nome do pavimento"
                    aria-label={`Pavimento ${i + 1}`}
                    maxLength={60}
                    className="h-8 min-w-0 flex-1 bg-transparent px-1 text-[13px] font-medium text-ink placeholder:text-ink-3 focus:outline-none"
                  />
                  <IconBtn label="Mover para cima" disabled={i === 0} onClick={() => move(i, -1)}>
                    <path d="M12 19V5M6 11l6-6 6 6" />
                  </IconBtn>
                  <IconBtn label="Mover para baixo" disabled={i === levels.length - 1} onClick={() => move(i, 1)}>
                    <path d="M12 5v14M6 13l6 6 6-6" />
                  </IconBtn>
                  <IconBtn label="Remover" danger onClick={() => setLevels(levels.filter((x) => x.key !== l.key))}>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </IconBtn>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <button
            type="button"
            onClick={() => setLevels([...levels, { key: levelKey(), name: `Pavimento ${levels.length + 1}` }])}
            className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line text-[12.5px] font-semibold text-action transition hover:border-brand hover:bg-brand-soft/40"
          >
            <IconPlus className="h-4 w-4" /> Adicionar pavimento
          </button>
          {errors.levels && <p className="mt-2 animate-pop text-[11.5px] font-medium text-danger">{errors.levels}</p>}
        </div>
      </div>

      {/* corte esquemático */}
      <div className="hidden lg:block">
        <p className="mb-2 text-[12px] font-semibold text-ink-2">Corte esquemático</p>
        <div className="sticky top-0 rounded-2xl bg-subtle p-4 ring-1 ring-inset ring-line-2">
          <div className="flex max-h-[440px] flex-col-reverse gap-1 overflow-y-auto">
            {levels.map((l, i) => {
              const below = /subsolo/i.test(l.name);
              const roof = /cobertura|telhado|ático/i.test(l.name);
              // a linha do solo fica entre o último subsolo e o primeiro pavimento acima dele
              const ground = !below && (i === 0 || /subsolo/i.test(levels[i - 1].name));
              return (
                <div key={l.key} className="flex flex-col-reverse gap-1">
                  {ground && (
                    <div className="py-1">
                      <div className="h-1.5 rounded-full bg-[repeating-linear-gradient(45deg,#b7c6d4_0_4px,transparent_4px_8px)]" />
                      <p className="mt-1 text-center text-[10px] font-semibold text-ink-3">nível do solo</p>
                    </div>
                  )}
                <motion.div
                  layout
                  initial={{ opacity: 0, scaleX: 0.6 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  transition={{ type: "spring", stiffness: 420, damping: 32, delay: Math.min(i, 10) * 0.02 }}
                  className={`truncate rounded-md px-2 py-1.5 text-center text-[10.5px] font-semibold ${
                    below
                      ? "bg-ink/[0.12] text-ink-2"
                      : roof
                        ? "mx-3 rounded-t-xl bg-gradient-to-b from-[#38b6ff] to-action text-white"
                        : "bg-white text-ink-2 shadow-xs ring-1 ring-line"
                  }`}
                >
                  {l.name || "—"}
                </motion.div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-3 transition disabled:opacity-25 ${danger ? "hover:bg-[#fdeeec] hover:text-danger" : "hover:bg-subtle hover:text-ink"}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="rounded-xl bg-white p-2 ring-1 ring-line">
      <p className="mb-1 px-1 text-[11px] font-semibold text-ink-3">{label}</p>
      <div className="flex items-center justify-between">
        <button type="button" aria-label={`Menos ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} className="grid h-7 w-7 place-items-center rounded-lg text-ink-2 transition hover:bg-subtle disabled:opacity-30">
          −
        </button>
        <span className="text-[15px] font-bold tabular text-ink">{value}</span>
        <button type="button" aria-label={`Mais ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} className="grid h-7 w-7 place-items-center rounded-lg text-ink-2 transition hover:bg-subtle disabled:opacity-30">
          +
        </button>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex flex-col justify-between rounded-xl bg-white p-2 text-left ring-1 ring-line transition hover:ring-field"
    >
      <span className="mb-1 px-1 text-[11px] font-semibold text-ink-3">{label}</span>
      <span className="flex items-center justify-between px-1">
        <span className="text-[12.5px] font-semibold text-ink">{checked ? "Sim" : "Não"}</span>
        <Switch on={checked} />
      </span>
    </button>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-300 ${on ? "bg-brand" : "bg-ink/15"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-300 ease-out-expo ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </span>
  );
}

/* ───────────────────────── etapa 3: contratada ───────────────────────── */

function StepContratada({ draft, update, errors }: StepProps) {
  const contractors = useApp((s) => s.contractors);
  const c = draft.contractor;
  const setC = (patch: Partial<ProjectDraft["contractor"]>) => update({ contractor: { ...c, ...patch } });
  const opts: { mode: ContractorMode; title: string; hint: string; disabled?: boolean }[] = [
    { mode: "existente", title: "Já cadastrada", hint: `${contractors.length} na organização`, disabled: contractors.length === 0 },
    { mode: "nova", title: "Nova contratada", hint: "Cadastrar agora" },
    { mode: "depois", title: "Definir depois", hint: "Obra sem contratada" },
  ];
  const cnpjOk = cnpjValido(c.cnpj);

  return (
    <div className="space-y-5">
      <div className="grid gap-2.5 sm:grid-cols-3">
        {opts.map((o) => {
          const active = draft.contractorMode === o.mode;
          return (
            <button
              key={o.mode}
              type="button"
              disabled={o.disabled}
              onClick={() => update({ contractorMode: o.mode })}
              className={`relative rounded-2xl p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                active ? "bg-brand-soft/70 ring-2 ring-brand" : "bg-white ring-1 ring-line hover:ring-field"
              }`}
            >
              <span className={`absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full transition ${active ? "bg-brand text-white" : "ring-1 ring-field"}`}>
                {active && <IconCheck className="h-3 w-3" />}
              </span>
              <p className="pr-6 text-[13px] font-semibold text-ink">{o.title}</p>
              <p className="text-[11.5px] text-ink-3">{o.hint}</p>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={draft.contractorMode}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
        >
          {draft.contractorMode === "existente" && (
            <div className="space-y-2">
              {contractors.map((k) => {
                const active = draft.contractorId === k.id;
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => update({ contractorId: k.id })}
                    className={`flex w-full items-center gap-3.5 rounded-2xl p-3.5 text-left transition ${
                      active ? "bg-brand-soft/60 ring-2 ring-brand" : "bg-white ring-1 ring-line hover:-translate-y-px hover:shadow-sm hover:ring-field"
                    }`}
                  >
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${active ? "bg-brand text-white" : "bg-brand-soft text-action"}`}>
                      <IconBriefcase className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-ink">{k.razaoSocial}</span>
                      <span className="block truncate text-[11.5px] text-ink-3">
                        <span className="font-mono">{k.cnpj}</span>
                        {k.responsavelTecnico && ` · ${k.responsavelTecnico}`}
                      </span>
                    </span>
                    {active && <IconCheck className="h-5 w-5 text-brand" />}
                  </button>
                );
              })}
              {errors.contractorId && <p className="animate-pop text-[11.5px] font-medium text-danger">{errors.contractorId}</p>}
            </div>
          )}

          {draft.contractorMode === "nova" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Razão social" required error={errors.razaoSocial} className="sm:col-span-2">
                <input autoFocus value={c.razaoSocial} onChange={(e) => setC({ razaoSocial: e.target.value })} placeholder="Ex.: Construtora Exemplo Ltda." className={inputCls(errors.razaoSocial)} />
              </Field>
              <Field label="CNPJ" required error={errors.cnpj}>
                <span className="relative block">
                  <input
                    value={c.cnpj}
                    inputMode="numeric"
                    onChange={(e) => setC({ cnpj: maskCnpj(e.target.value) })}
                    placeholder="00.000.000/0000-00"
                    className={`${inputCls(errors.cnpj)} pr-10 font-mono text-[13px]`}
                  />
                  {cnpjOk && (
                    <span className="absolute right-3 top-1/2 grid h-5 w-5 -translate-y-1/2 animate-pop place-items-center rounded-full bg-positive text-white">
                      <IconCheck className="h-3 w-3" />
                    </span>
                  )}
                </span>
              </Field>
              <Field label="E-mail de contato" error={errors.email}>
                <input type="email" value={c.email} onChange={(e) => setC({ email: e.target.value })} placeholder="obras@empresa.com.br" className={inputCls(errors.email)} />
              </Field>
              <Field label="Responsável técnico">
                <input value={c.responsavelTecnico} onChange={(e) => setC({ responsavelTecnico: e.target.value })} placeholder="Eng. Civil Nome Sobrenome" className={inputCls()} />
              </Field>
              <Field label="CREA">
                <input value={c.crea} onChange={(e) => setC({ crea: e.target.value })} placeholder="CREA-AL 0000000000" className={`${inputCls()} font-mono text-[13px]`} />
              </Field>
              <Field label="Preposto na obra" hint="Representante da contratada no canteiro." className="sm:col-span-2">
                <input value={c.preposto} onChange={(e) => setC({ preposto: e.target.value })} placeholder="Nome do preposto" className={inputCls()} />
              </Field>
            </div>
          )}

          {draft.contractorMode === "depois" && (
            <div className="flex items-start gap-3 rounded-2xl bg-[#fdf4e2] p-4 text-[12.5px] leading-relaxed text-warn ring-1 ring-inset ring-[#efdcb0]">
              <IconShield className="mt-0.5 h-4 w-4 shrink-0" />
              A obra fica sem contratada vinculada. Plantas, diário e tour funcionam normalmente, mas as não conformidades
              não terão a quem ser notificadas até haver uma contratada na obra.
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ───────────────────────── etapa 4: contrato ───────────────────────── */

function StepContrato({ draft, update, errors }: StepProps) {
  const k = draft.contract;
  const setK = (patch: Partial<ProjectDraft["contract"]>) => update({ contract: { ...k, ...patch } });
  return (
    <div className="space-y-5">
      <button
        type="button"
        role="switch"
        aria-checked={draft.withContract}
        onClick={() => update({ withContract: !draft.withContract })}
        className="flex w-full items-center gap-3.5 rounded-2xl bg-white p-4 text-left ring-1 ring-line transition hover:ring-field"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-action">
          <IconFileText className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold text-ink">Cadastrar o contrato agora</span>
          <span className="block text-[11.5px] text-ink-3">Número, vigência, valor, designações e prazos de reparo</span>
        </span>
        <Switch on={draft.withContract} />
      </button>

      <AnimatePresence initial={false} mode="wait">
        {draft.withContract ? (
          <motion.div
            key="com"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="grid gap-4 p-0.5 sm:grid-cols-2">
              <Field label="Número do contrato" required error={errors.numero}>
                <input value={k.numero} onChange={(e) => setK({ numero: e.target.value })} placeholder="CT 012/2026" className={`${inputCls(errors.numero)} font-mono text-[13px]`} />
              </Field>
              <Field label="Processo administrativo">
                <input value={k.processo} onChange={(e) => setK({ processo: e.target.value })} placeholder="E:01100.0000000/2026" className={`${inputCls()} font-mono text-[13px]`} />
              </Field>
              <Field label="Início da vigência" hint={!k.vigenciaInicio && draft.startsAt ? `Se vazio, usa o início da obra (${fmtDate(draft.startsAt)})` : undefined}>
                <input type="date" value={k.vigenciaInicio} onChange={(e) => setK({ vigenciaInicio: e.target.value })} className={inputCls()} />
              </Field>
              <Field label="Fim da vigência" error={errors.vigenciaFim} hint={!k.vigenciaFim && draft.endsAt ? `Se vazio, usa a entrega (${fmtDate(draft.endsAt)})` : undefined}>
                <input type="date" value={k.vigenciaFim} onChange={(e) => setK({ vigenciaFim: e.target.value })} className={inputCls(errors.vigenciaFim)} />
              </Field>
              <Field label="Valor do contrato">
                <span className="relative block">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-ink-3">R$</span>
                  <input value={k.valor} inputMode="numeric" onChange={(e) => setK({ valor: maskBrl(e.target.value) })} placeholder="0,00" className={`${inputCls()} pl-10 tabular`} />
                </span>
              </Field>
              <Field label="Portaria de designação">
                <input value={k.portariaDesignacao} onChange={(e) => setK({ portariaDesignacao: e.target.value })} placeholder="Portaria nº 000/2026" className={inputCls()} />
              </Field>
              <Field label="Fiscal designado">
                <input value={k.fiscalDesignado} onChange={(e) => setK({ fiscalDesignado: e.target.value })} placeholder="Nome do fiscal do contrato" className={inputCls()} />
              </Field>
              <Field label="Gestor do contrato">
                <input value={k.gestorDesignado} onChange={(e) => setK({ gestorDesignado: e.target.value })} placeholder="Nome do gestor" className={inputCls()} />
              </Field>

              <div className="sm:col-span-2">
                <p className="mb-2 text-[12px] font-semibold text-ink-2">Prazos de reparo por severidade</p>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {SEVERIDADES.map((s) => (
                    <label key={s.key} className={`rounded-2xl p-3 ring-1 ring-inset ${s.tone}`}>
                      <span className="text-[11.5px] font-semibold">{s.label}</span>
                      <span className="mt-1 flex items-baseline gap-1.5">
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={Number.isNaN(k.prazos[s.key]) ? "" : k.prazos[s.key]}
                          onChange={(e) => setK({ prazos: { ...k.prazos, [s.key]: Math.trunc(Number(e.target.value)) } })}
                          className="w-14 rounded-lg bg-white/80 px-2 py-1 text-[16px] font-bold tabular text-ink ring-1 ring-inset ring-black/5 focus:outline-none focus:ring-2 focus:ring-brand/50"
                        />
                        <span className="text-[11.5px] font-medium">dias</span>
                      </span>
                      {errors[`prazo_${s.key}`] && <span className="mt-1 block text-[10.5px] font-semibold text-danger">{errors[`prazo_${s.key}`]}</span>}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="sem"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-3 rounded-2xl bg-brand-soft p-4 text-[12.5px] leading-relaxed text-action ring-1 ring-inset ring-[#cfe7fb]"
          >
            <IconShield className="mt-0.5 h-4 w-4 shrink-0" />
            Sem contrato, as não conformidades usam os prazos padrão: crítica 2 dias, alta 7, média 15 e baixa 30.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────────────────── etapa 5: mídia ───────────────────────── */

function StepMidia({ draft, update, errors }: StepProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [thumbState, setThumbState] = useState<"loading" | "ok" | "fail">("loading");
  const mpId = extractMatterportId(draft.matterport);
  const mpOk = matterportValido(mpId);

  useEffect(() => setThumbState("loading"), [mpId]);

  async function pick(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setReadError("Envie uma imagem (JPG, PNG ou WebP).");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setReadError("Imagem maior que 15 MB.");
      return;
    }
    try {
      setReadError(null);
      update({ cover: await fileToDataUrl(file) });
    } catch {
      setReadError("Não foi possível ler a imagem.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-[12px] font-semibold text-ink-2">Foto de capa</p>
        {draft.cover ? (
          <div className="group relative aspect-[16/10] overflow-hidden rounded-2xl ring-1 ring-line animate-pop">
            <img src={draft.cover} alt="Capa da obra" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-[linear-gradient(transparent,rgb(6_26_46/0.7))] p-3">
              <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-sm bg-white/90 text-ink backdrop-blur hover:bg-white">
                <IconCamera className="h-3.5 w-3.5" /> Trocar
              </button>
              <button type="button" onClick={() => update({ cover: "" })} className="btn btn-sm bg-white/90 text-danger backdrop-blur hover:bg-white">
                Remover
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void pick(e.dataTransfer.files?.[0]);
            }}
            className={`flex aspect-[16/10] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed text-center transition ${
              drag ? "scale-[1.01] border-brand bg-brand-soft/60" : "border-line hover:border-brand hover:bg-brand-soft/40"
            }`}
          >
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-action ring-1 ring-inset ring-[#cfe7fb]">
              <IconCamera className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[13px] font-semibold text-ink">Arraste a foto aqui</span>
              <span className="block text-[11.5px] text-ink-3">ou clique para escolher · JPG, PNG ou WebP até 15 MB</span>
            </span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {readError && <p className="mt-2 animate-pop text-[11.5px] font-medium text-danger">{readError}</p>}
      </div>

      <div>
        <Field
          label="Modelo Matterport (tour 360)"
          error={errors.matterport}
          hint={mpId && mpId !== draft.matterport.trim() ? <>Identificador lido do link: <span className="font-mono text-ink-2">{mpId}</span></> : "Cole o identificador ou o link do showcase (…?m=…)."}
        >
          <span className="relative block">
            <IconRotate360 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input
              value={draft.matterport}
              onChange={(e) => update({ matterport: e.target.value })}
              placeholder="JKDH2SEKWcv ou https://my.matterport.com/show/?m=…"
              className={`${inputCls(errors.matterport)} pl-10`}
            />
          </span>
        </Field>
        <div className="mt-3 overflow-hidden rounded-2xl bg-[#0b1a28] ring-1 ring-line">
          <div className="relative aspect-[16/10]">
            {mpOk ? (
              <>
                {thumbState === "loading" && <div className="skeleton absolute inset-0 rounded-none opacity-20" />}
                {thumbState !== "fail" ? (
                  <img
                    key={mpId}
                    src={thumbUrl(mpId)}
                    alt="Miniatura do modelo"
                    onLoad={() => setThumbState("ok")}
                    onError={() => setThumbState("fail")}
                    className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${thumbState === "ok" ? "opacity-100" : "opacity-0"}`}
                  />
                ) : (
                  <p className="absolute inset-0 grid place-items-center px-6 text-center text-[12px] text-white/60">
                    Não encontramos a miniatura deste modelo. Confira o identificador — se o modelo for privado, o tour ainda pode funcionar.
                  </p>
                )}
                {thumbState === "ok" && (
                  <span className="absolute left-3 top-3 inline-flex animate-pop items-center gap-1.5 rounded-full bg-[rgb(8_20_32/0.62)] px-2.5 py-1 text-[11px] font-semibold text-white ring-1 ring-white/15 backdrop-blur">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Modelo encontrado
                  </span>
                )}
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/40">
                <IconRotate360 className="h-8 w-8" />
                <p className="text-[11.5px]">A prévia do tour aparece aqui</p>
              </div>
            )}
          </div>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
          {!draft.cover && mpOk
            ? "Sem foto de capa, a miniatura do tour vira a capa da obra."
            : "Sem modelo, a obra funciona com plantas e diário; o Tour 360 fica indisponível."}
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────── etapa 6: revisão ───────────────────────── */

function StepRevisao({ draft, onEdit }: { draft: ProjectDraft; onEdit: (i: number) => void }) {
  const contractors = useApp((s) => s.contractors);
  const mpId = extractMatterportId(draft.matterport);
  const existing = contractors.find((k) => k.id === draft.contractorId);
  const valor = parseBrl(draft.contract.valor);
  const cover = draft.cover || (matterportValido(mpId) ? thumbUrl(mpId) : "");

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-3xl bg-[linear-gradient(140deg,#164a75,#0a2540)] text-white shadow-lg">
        {cover && <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(10_37_64/0.95),rgb(10_37_64/0.4))]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4 p-5 sm:p-6">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-white/60">{draft.client}</p>
            <p className="font-display text-[24px] font-bold leading-tight tracking-[-0.02em]">{draft.name}</p>
            {draft.address && (
              <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-white/60">
                <IconMapPin className="h-3.5 w-3.5" /> {draft.address}
              </p>
            )}
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-2.5 text-right ring-1 ring-inset ring-white/15 backdrop-blur">
            <p className="text-[11px] text-white/55">Entrega prevista</p>
            <p className="text-[14px] font-bold">{fmtDate(draft.endsAt)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Resumo title="Dados da obra" onEdit={() => onEdit(0)}>
          <Linha k="Início" v={draft.startsAt ? fmtDate(draft.startsAt) : "—"} />
          <Linha k="Entrega" v={fmtDate(draft.endsAt)} />
          <Linha k="Avanço físico" v={`${draft.progressPct}%`} />
        </Resumo>
        <Resumo title={`Pavimentos (${draft.levels.length})`} onEdit={() => onEdit(1)}>
          <div className="flex flex-wrap gap-1.5">
            {draft.levels.map((l) => (
              <span key={l.key} className="rounded-full bg-subtle px-2.5 py-1 text-[11.5px] font-medium text-ink-2 ring-1 ring-inset ring-line-2">
                {l.name}
              </span>
            ))}
          </div>
        </Resumo>
        <Resumo title="Contratada" onEdit={() => onEdit(2)}>
          {draft.contractorMode === "existente" && existing ? (
            <>
              <Linha k="Razão social" v={existing.razaoSocial} />
              <Linha k="CNPJ" v={<span className="font-mono">{existing.cnpj}</span>} />
            </>
          ) : draft.contractorMode === "nova" ? (
            <>
              <Linha k="Razão social" v={draft.contractor.razaoSocial} />
              <Linha k="CNPJ" v={<span className="font-mono">{draft.contractor.cnpj}</span>} />
              <span className="mt-1 inline-flex rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-semibold text-action">nova no cadastro</span>
            </>
          ) : (
            <p className="text-[12.5px] text-ink-3">Definir depois</p>
          )}
        </Resumo>
        <Resumo title="Contrato" onEdit={() => onEdit(3)}>
          {draft.withContract ? (
            <>
              <Linha k="Número" v={<span className="font-mono">{draft.contract.numero}</span>} />
              <Linha k="Valor" v={valor !== undefined ? fmtBrl(valor) : "—"} />
              <Linha
                k="Prazos"
                v={`${draft.contract.prazos.critica}/${draft.contract.prazos.alta}/${draft.contract.prazos.media}/${draft.contract.prazos.baixa} dias`}
              />
            </>
          ) : (
            <p className="text-[12.5px] text-ink-3">Sem contrato — prazos padrão</p>
          )}
        </Resumo>
        <Resumo title="Foto e tour 360" onEdit={() => onEdit(4)} className="sm:col-span-2">
          <Linha k="Capa" v={draft.cover ? "Foto enviada" : matterportValido(mpId) ? "Miniatura do tour" : "Sem foto"} />
          <Linha k="Modelo Matterport" v={mpId ? <span className="font-mono">{mpId}</span> : "Não vinculado"} />
        </Resumo>
      </div>
    </div>
  );
}

function Resumo({ title, onEdit, children, className = "" }: { title: string; onEdit: () => void; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white p-4 ring-1 ring-line ${className}`}>
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <button type="button" onClick={onEdit} className="text-[12px] font-semibold text-action hover:underline">
          Editar
        </button>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Linha({ k, v }: { k: string; v: ReactNode }) {
  return (
    <p className="flex items-baseline justify-between gap-3 text-[12.5px]">
      <span className="shrink-0 text-ink-3">{k}</span>
      <span className="min-w-0 truncate text-right font-medium text-ink">{v}</span>
    </p>
  );
}

/* ───────────────────────── fim ───────────────────────── */

function Success({
  project,
  levels,
  warnings,
  onOpen,
  onAnother,
  onClose,
}: {
  project: Project;
  levels: number;
  warnings: string[];
  onOpen: () => void;
  onAnother: () => void;
  onClose: () => void;
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 text-center">
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/15 blur-3xl" />
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="relative grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-[#38d39f] to-positive text-white shadow-[0_18px_40px_-12px_rgb(47_138_91/0.7)]"
      >
        <span className="absolute inset-0 animate-ping rounded-full bg-positive/25" />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="relative h-11 w-11" aria-hidden>
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.25, duration: 0.5, ease: "easeOut" }} />
        </svg>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="relative">
        <h2 className="mt-6 font-display text-[26px] font-bold tracking-[-0.025em] text-ink">Obra cadastrada!</h2>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-2">
          <b className="font-semibold text-ink">{project.name}</b> já está na sua carteira, com {levels} pavimento
          {levels === 1 ? "" : "s"}
          {project.contract ? " e o contrato registrado" : ""}.
        </p>
        {warnings.map((w) => (
          <p key={w} className="mx-auto mt-4 flex max-w-md items-start gap-2 rounded-xl bg-[#fdf4e2] px-3.5 py-2.5 text-left text-[12px] leading-relaxed text-warn ring-1 ring-inset ring-[#efdcb0]">
            <IconShield className="mt-px h-4 w-4 shrink-0" />
            {w}
          </p>
        ))}
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          <button type="button" onClick={onOpen} className="btn btn-lg btn-primary">
            Abrir painel da obra <IconArrowRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={onAnother} className="btn btn-lg btn-secondary">
            <IconPlus className="h-4 w-4" /> Cadastrar outra
          </button>
        </div>
        <button type="button" onClick={onClose} className="mt-4 text-[12.5px] font-semibold text-ink-3 hover:text-ink">
          Voltar para as obras
        </button>
      </motion.div>
    </div>
  );
}

function Locked({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-soft text-action ring-1 ring-inset ring-[#cfe7fb]">
        <IconShield className="h-7 w-7" />
      </span>
      <h2 className="mt-5 font-display text-[22px] font-bold tracking-[-0.02em] text-ink">Cadastro feito pelo gestor do contrato</h2>
      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-ink-2">
        Obra, contrato e contratada são registrados pelo perfil <b className="font-semibold text-ink">Gestor do contrato</b>. Entre com um
        usuário gestor para cadastrar uma nova obra.
      </p>
      <button type="button" onClick={onClose} className="btn btn-lg btn-secondary mt-6">
        Entendi
      </button>
    </div>
  );
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />;
}
