import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fmtDate, levelsOf, projectById } from "../data/catalog";
import {
  NC_ACTION_LABEL, RDO_PERIOD_LABEL, RDO_WEATHER_LABEL,
  RDO_PHOTO_KIND_LABEL,
  type Issue, type Rdo, type RdoCrewRow, type RdoPeriod, type RdoPhotoKind, type RdoWeather,
} from "../types";
import { caminhoDaObra, useObraId } from "../obra";
import { exportBackup, importBackup, useApp } from "../store";
import { draftRdo } from "../lib/ai";
import { verificadaNoRdo } from "../lib/nc-flow";
import {
  EmptyState,
  IconAlert,
  IconArrowRight,
  IconBook,
  IconCamera,
  IconCheck,
  IconClose,
  IconCrosshair,
  IconFileText,
  IconPlus,
  IconReport,
  IconRotate360,
  IconSpark,
  Micro,
  PageHeader,
  StatusChip,
  Wordmark,
} from "../components/ui";

/* Ícones locais — mesmo traço 24 de `ui.tsx` */
type GlyphProps = { className?: string };
const glyph = (className?: string) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: className ?? "h-4 w-4",
  "aria-hidden": true,
});
const IconArrowLeft = ({ className }: GlyphProps) => (
  <svg {...glyph(className)}><path d="M19 12H5" /><path d="M11 6l-6 6 6 6" /></svg>
);
const IconDownload = ({ className }: GlyphProps) => (
  <svg {...glyph(className)}><path d="M12 4v11" /><path d="M7.5 10.5L12 15l4.5-4.5" /><path d="M4 15v2.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V15" /></svg>
);
const IconUpload = ({ className }: GlyphProps) => (
  <svg {...glyph(className)}><path d="M12 15V4" /><path d="M7.5 8.5L12 4l4.5 4.5" /><path d="M4 15v2.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V15" /></svg>
);
const IconPrinter = ({ className }: GlyphProps) => (
  <svg {...glyph(className)}><path d="M7 9V4h10v5" /><rect x="3.5" y="9" width="17" height="8" rx="2.5" /><path d="M7 14h10v6H7z" /></svg>
);
const IconTrash = ({ className }: GlyphProps) => (
  <svg {...glyph(className)}><path d="M4 7h16" /><path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" /><path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" /></svg>
);
const IconSun = ({ className }: GlyphProps) => (
  <svg {...glyph(className)}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>
);
const IconUsers = ({ className }: GlyphProps) => (
  <svg {...glyph(className)}><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6" /><path d="M18.5 14.4A6.5 6.5 0 0 1 21.5 20" /></svg>
);
const IconTool = ({ className }: GlyphProps) => (
  <svg {...glyph(className)}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.5 17.3a1.8 1.8 0 0 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.3-.5-.5-2.3 2.6-2.6z" /></svg>
);
const IconLock = ({ className }: GlyphProps) => (
  <svg {...glyph(className)}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
);

/** Chip do estado do RDO — rascunho em tom de alerta, fechado em tom positivo. */
function RdoStatus({ status }: { status: Rdo["status"] }) {
  const fechado = status === "fechado";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-semibold tracking-normal ring-1 ring-inset ${
        fechado ? "bg-[#e8f6ed] text-positive ring-[#c4e5d0]" : "bg-[#fdf4e2] text-warn ring-[#efdcb0]"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {fechado ? "Fechado" : "Rascunho"}
    </span>
  );
}

const PERIODS: RdoPeriod[] = ["manha", "tarde", "noite"];

/** Uma entrada do anexo fotográfico do documento. */
interface AnnexPhoto {
  id: string;
  imageDataUrl: string;
  createdAt: string;
  label?: string;
  caption?: string;
  kind?: RdoPhotoKind;
}
const today = () => new Date().toISOString().slice(0, 10);


export default function RdoPage() {
  const projectId = useObraId();
  const project = projectById(projectId);
  const rdos = useApp((s) => s.rdos).filter((r) => r.projectId === projectId);
  const createRdo = useApp((s) => s.createRdo);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(params.get("rdo"));

  const current = rdos.find((r) => r.id === openId) ?? null;
  if (!project) return null;

  if (current) {
    return <RdoEditor rdo={current} onBack={() => setOpenId(null)} />;
  }

  const novoRdo = () => {
    const novo = createRdo(projectId, today());
    navigate(caminhoDaObra(projectId, `diario/${novo.id}/visita`));
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-5 pb-14 pt-4 lg:px-8">
        <div className="reveal" style={{ ["--i" as string]: 0 }}>
          <PageHeader
            title="Diário de obra"
            subtitle="Relatórios diários da obra, com o registro 360° da visita como anexo probatório."
            actions={
              <>
                <BackupControls />
                <button onClick={novoRdo} className="btn btn-primary">
                  <IconPlus className="h-4 w-4" />
                  Novo RDO
                </button>
              </>
            }
          />
        </div>

        <StorageNotice />

        <div className="mt-7">
          {rdos.length === 0 ? (
            <div className="card reveal" style={{ ["--i" as string]: 1 }}>
              <EmptyState
                icon={<IconBook className="h-6 w-6" />}
                title="Nenhum relatório ainda"
                action={
                  <button onClick={novoRdo} className="btn btn-primary">
                    <IconPlus className="h-4 w-4" />
                    Novo RDO
                  </button>
                }
              >
                Crie o RDO do dia: a <b className="font-semibold text-ink">visita guiada</b> abre o tour ao
                lado do caderno de campo e a IA redige a observação de cada frente registrada.
              </EmptyState>
            </div>
          ) : (
            <div className="grid gap-3">
              {rdos
                .slice()
                .sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number)
                .map((r, idx) => {
                  const anexos = r.stops.length || r.analysisIds.length;
                  const fechado = r.status === "fechado";
                  return (
                    <button
                      key={r.id}
                      onClick={() => setOpenId(r.id)}
                      className="card card-hover reveal group flex w-full items-center gap-4 p-4 text-left sm:px-5"
                      style={{ ["--i" as string]: Math.min(idx + 1, 12) }}
                    >
                      <span
                        className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-b to-white ring-1 ring-inset transition-transform duration-500 ease-out-expo group-hover:scale-105 ${
                          fechado ? "from-[#e8f6ed] text-positive ring-[#c4e5d0]" : "from-brand-soft text-action ring-[#d4ebfb]"
                        }`}
                      >
                        {fechado ? <IconCheck className="h-5 w-5" /> : <IconBook className="h-5 w-5" />}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className="text-[14.5px] font-semibold tracking-[-0.01em] text-ink tabular">{fmtDate(r.date)}</span>
                          <span className="font-mono text-[11.5px] font-medium text-ink-3">
                            #{String(r.number).padStart(3, "0")}
                          </span>
                          <RdoStatus status={r.status} />
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] font-medium text-ink-3">
                          <span className="inline-flex items-center gap-1.5">
                            <IconCamera className="h-3.5 w-3.5" />
                            {anexos} anexo{anexos === 1 ? "" : "s"}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <IconAlert className="h-3.5 w-3.5" />
                            {r.issueIds.length} NC{r.issueIds.length === 1 ? "" : "s"} citada{r.issueIds.length === 1 ? "" : "s"}
                          </span>
                          {r.aiDrafted && (
                            <span className="inline-flex items-center gap-1.5 text-action">
                              <IconSpark className="h-3.5 w-3.5" />
                              redigido com IA
                            </span>
                          )}
                        </span>
                      </span>

                      <span
                        role="link"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); navigate(caminhoDaObra(projectId, `diario/${r.id}/visita`)); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); navigate(caminhoDaObra(projectId, `diario/${r.id}/visita`)); } }}
                        className="btn btn-ghost btn-sm hidden sm:inline-flex"
                      >
                        <IconRotate360 className="h-4 w-4" />
                        visita guiada
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-action">
                        Abrir
                        <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                      </span>
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RdoEditor({ rdo, onBack }: { rdo: Rdo; onBack: () => void }) {
  const navigate = useNavigate();
  const project = projectById(rdo.projectId)!;
  const update = useApp((s) => s.updateRdo);
  const close = useApp((s) => s.closeRdo);
  const remove = useApp((s) => s.deleteRdo);
  const analyses = useApp((s) => s.analyses).filter((a) => a.projectId === rdo.projectId);
  const issues = useApp((s) => s.issues).filter((i) => i.projectId === rdo.projectId);

  const [tab, setTab] = useState<"editar" | "documento">("editar");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const locked = rdo.status === "fechado";
  const set = (patch: Partial<Rdo>) => { if (!locked) update(rdo.id, patch); };

  const sameDay = useMemo(
    () => analyses.filter((a) => a.createdAt.slice(0, 10) === rdo.date),
    [analyses, rdo.date],
  );
  const attached = analyses.filter((a) => rdo.analysisIds.includes(a.id));
  // o anexo fotográfico é a caminhada quando houve visita guiada
  const annex: AnnexPhoto[] = rdo.stops.length > 0
    ? rdo.stops.flatMap((s) =>
        s.photos.map((p) => ({
          id: p.id,
          imageDataUrl: p.imageDataUrl,
          createdAt: p.createdAt,
          label: s.label,
          caption: p.caption,
          kind: p.kind,
        })),
      )
    : attached.map((a) => ({ id: a.id, imageDataUrl: a.imageDataUrl, createdAt: a.createdAt }));
  const openIssues = issues.filter((i) => i.status !== "resolvido");

  const runDraft = async () => {
    // preferência: vistas anexadas > vistas do dia > vistas mais recentes da obra
    const chosen = attached.length > 0 ? attached : sameDay.length > 0 ? sameDay : analyses.slice(0, 4);
    if (chosen.length === 0) {
      setDraftError("Nenhuma vista analisada nesta obra. Use “Analisar com IA” no Tour 360 primeiro.");
      return;
    }
    setDrafting(true);
    setDraftError(null);
    try {
      const draft = await draftRdo(
        chosen.map((a) => ({ imageDataUrl: a.imageDataUrl, previousAnalysis: a.result })),
        {
          project: project.name,
          date: fmtDate(rdo.date),
          levels: levelsOf(rdo.projectId).map((l) => l.name).join(", "),
          openIssues: openIssues.map((i) => `${i.title} (${i.local})`),
          projectId: rdo.projectId,
        },
      );
      set({
        servicesExecuted: draft.servicesExecuted || rdo.servicesExecuted,
        occurrences: draft.occurrences || rdo.occurrences,
        nonConformities: draft.nonConformities || rdo.nonConformities,
        notes: draft.notes || rdo.notes,
        analysisIds: rdo.analysisIds.length ? rdo.analysisIds : chosen.map((a) => a.id),
        aiDrafted: true,
        aiSimulated: draft.simulated,
      });
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Falha ao redigir o rascunho");
    } finally {
      setDrafting(false);
    }
  };

  if (tab === "documento") {
    return (
      <RdoDocument
        rdo={rdo}
        annex={annex}
        issues={issues.filter((i) => rdo.issueIds.includes(i.id))}
        verified={issues.filter((i) => verificadaNoRdo(i, rdo.id).length > 0)}
        onEdit={() => setTab("editar")}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 pb-14 pt-4 lg:px-8">
        {/* cabeçalho */}
        <button onClick={onBack} className="btn btn-ghost btn-sm -ml-2 mb-3">
          <IconArrowLeft className="h-4 w-4" />
          Diário de obra
        </button>

        <div className="reveal" style={{ ["--i" as string]: 0 }}>
          <PageHeader
            eyebrow={project.name}
            title={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="tabular">RDO nº {String(rdo.number).padStart(3, "0")}</span>
                <RdoStatus status={rdo.status} />
              </span>
            }
            actions={
              <>
                <button
                  onClick={() => navigate(caminhoDaObra(rdo.projectId, `diario/${rdo.id}/visita`))}
                  className="btn btn-secondary"
                >
                  <IconRotate360 className="h-4 w-4" />
                  Visita guiada
                </button>
                <button onClick={() => setTab("documento")} className="btn btn-secondary">
                  <IconReport className="h-4 w-4" />
                  Documento
                </button>
                {!locked && (
                  <button onClick={() => close(rdo.id)} className="btn btn-primary">
                    <IconCheck className="h-4 w-4" />
                    Fechar RDO
                  </button>
                )}
              </>
            }
          />
        </div>

        {locked && (
          <p className="mt-5 flex animate-pop items-start gap-2.5 rounded-xl bg-[#e8f6ed] px-3.5 py-3 text-[12.5px] leading-relaxed text-positive ring-1 ring-inset ring-[#c4e5d0]">
            <IconLock className="mt-px h-4 w-4 shrink-0" />
            Relatório fechado — o conteúdo não pode mais ser alterado. Gere um novo RDO para o dia seguinte.
          </p>
        )}

        <div className="mt-6 space-y-5">
          {/* identificação */}
          <Section i={1} icon={<IconFileText className="h-4 w-4" />} title="Identificação">
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label="Data">
                <input type="date" value={rdo.date} disabled={locked}
                  onChange={(e) => set({ date: e.target.value })} className="field" />
              </Labeled>
              <Labeled label="Responsável técnico">
                <input value={rdo.responsible} disabled={locked}
                  onChange={(e) => set({ responsible: e.target.value })} className="field" />
              </Labeled>
            </div>
          </Section>

          {/* clima */}
          <Section i={2} icon={<IconSun className="h-4 w-4" />} title="Condições do tempo e praticabilidade">
            <div className="grid gap-3 sm:grid-cols-3">
              {PERIODS.map((p) => (
                <div key={p} className="rounded-xl bg-subtle p-3.5 ring-1 ring-inset ring-line-2">
                  <span className="label mb-2 block">{RDO_PERIOD_LABEL[p]}</span>
                  <select
                    value={rdo.weather[p]}
                    disabled={locked}
                    onChange={(e) => set({ weather: { ...rdo.weather, [p]: e.target.value as RdoWeather } })}
                    className="field mb-3"
                  >
                    {(Object.keys(RDO_WEATHER_LABEL) as RdoWeather[]).map((w) => (
                      <option key={w} value={w}>{RDO_WEATHER_LABEL[w]}</option>
                    ))}
                  </select>
                  <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium text-ink-2">
                    <input
                      type="checkbox"
                      checked={rdo.workable[p]}
                      disabled={locked}
                      onChange={(e) => set({ workable: { ...rdo.workable, [p]: e.target.checked } })}
                      className="h-4 w-4 rounded accent-action"
                    />
                    Praticável
                  </label>
                </div>
              ))}
            </div>
          </Section>

          {/* efetivo e equipamentos */}
          <Section i={3} icon={<IconUsers className="h-4 w-4" />} title="Efetivo em campo">
            <CrewTable
              rows={rdo.crew}
              locked={locked}
              addLabel="Adicionar função"
              onChange={(crew) => set({ crew })}
            />
          </Section>

          <Section i={4} icon={<IconTool className="h-4 w-4" />} title="Equipamentos em operação">
            <CrewTable
              rows={rdo.equipment}
              locked={locked}
              addLabel="Adicionar equipamento"
              onChange={(equipment) => set({ equipment })}
            />
          </Section>

          {/* redação assistida */}
          <Section
            i={5}
            icon={<IconSpark className="h-4 w-4" />}
            title="Relato da visita"
            action={
              !locked && (
                <button onClick={runDraft} disabled={drafting} className="btn btn-accent btn-sm">
                  <IconSpark className={`h-4 w-4 ${drafting ? "animate-pulse" : ""}`} />
                  {drafting ? "Redigindo…" : "Redigir com o tour"}
                </button>
              )
            }
          >
            <p className="mb-4 rounded-xl bg-brand-soft/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2 ring-1 ring-inset ring-[#cfe7fb]">
              A IA compõe o rascunho lendo as vistas 360° analisadas
              {attached.length > 0
                ? ` — ${attached.length} vista${attached.length === 1 ? "" : "s"} anexada${attached.length === 1 ? "" : "s"} abaixo.`
                : sameDay.length > 0
                  ? ` — ${sameDay.length} vista${sameDay.length === 1 ? "" : "s"} registrada${sameDay.length === 1 ? "" : "s"} nesta data serão usadas.`
                  : analyses.length > 0
                    ? ` — sem vistas nesta data; serão usadas as ${Math.min(4, analyses.length)} mais recentes da obra.`
                    : " — nenhuma vista disponível ainda; analise vistas no Tour 360."}
              {" "}Revise e ajuste antes de fechar: a responsabilidade técnica é sua.
            </p>
            {draftError && (
              <p className="mb-4 animate-pop rounded-xl bg-[#fdeeec] px-3.5 py-2.5 text-[12.5px] text-danger ring-1 ring-inset ring-[#f5d0cb]">
                {draftError}
              </p>
            )}
            {rdo.aiSimulated && rdo.aiDrafted && (
              <p className="mb-4 animate-pop rounded-xl bg-[#fdf4e2] px-3.5 py-2.5 text-[12.5px] text-warn ring-1 ring-inset ring-[#efdcb0]">
                Rascunho simulado — configure a chave da Anthropic no Tour 360 para redação real das imagens.
              </p>
            )}

            <Labeled label="Serviços executados">
              <textarea rows={5} value={rdo.servicesExecuted} disabled={locked}
                onChange={(e) => set({ servicesExecuted: e.target.value })} className="field leading-relaxed" />
            </Labeled>
            <Labeled label="Ocorrências">
              <textarea rows={3} value={rdo.occurrences} disabled={locked}
                onChange={(e) => set({ occurrences: e.target.value })} className="field leading-relaxed" />
            </Labeled>
            <Labeled label="Não conformidades observadas">
              <textarea rows={3} value={rdo.nonConformities} disabled={locked}
                onChange={(e) => set({ nonConformities: e.target.value })} className="field leading-relaxed" />
            </Labeled>
            <Labeled label="Observações">
              <textarea rows={3} value={rdo.notes} disabled={locked}
                onChange={(e) => set({ notes: e.target.value })} className="field leading-relaxed" />
            </Labeled>
          </Section>

          {/* anexo fotográfico */}
          <Section i={6} icon={<IconCamera className="h-4 w-4" />} title={`Anexo fotográfico do registro 360° (${attached.length})`}>
            {analyses.length === 0 ? (
              <p className="rounded-2xl border-2 border-dashed border-line bg-subtle/60 px-4 py-7 text-center text-[12.5px] leading-relaxed text-ink-2">
                Nenhuma vista analisada nesta obra. No <b className="font-semibold text-ink">Tour 360</b>,
                use “Analisar com IA” nas frentes de serviço do dia.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {analyses.slice(0, 12).map((a) => {
                  const on = rdo.analysisIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      disabled={locked}
                      aria-pressed={on}
                      onClick={() =>
                        set({
                          analysisIds: on
                            ? rdo.analysisIds.filter((x) => x !== a.id)
                            : [...rdo.analysisIds, a.id],
                        })
                      }
                      className={`group relative overflow-hidden rounded-xl bg-white text-left transition-[box-shadow,translate] duration-300 ease-out-expo disabled:cursor-default ${
                        on ? "shadow-md ring-2 ring-brand" : "ring-1 ring-line hover:-translate-y-0.5 hover:shadow-md hover:ring-field"
                      }`}
                    >
                      <span className="block overflow-hidden">
                        <img
                          src={a.imageDataUrl}
                          alt=""
                          className="aspect-video w-full object-cover transition-transform duration-500 ease-out-expo group-hover:scale-105"
                        />
                      </span>
                      {on && (
                        <span className="absolute right-2 top-2 grid h-6 w-6 animate-pop place-items-center rounded-full bg-brand text-white shadow-md ring-2 ring-white">
                          <IconCheck className="h-3.5 w-3.5" />
                        </span>
                      )}
                      <span className="block px-2.5 py-2">
                        <Micro>
                          {new Date(a.createdAt).toLocaleString("pt-BR", {
                            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                          })}
                          {a.createdAt.slice(0, 10) === rdo.date ? " · hoje" : ""}
                        </Micro>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          {/* pendências */}
          <Section
            i={7}
            icon={<IconAlert className="h-4 w-4" />}
            title={`Não conformidades citadas (${rdo.issueIds.length})`}
            action={
              !locked && openIssues.length > 0 && (
                <button
                  onClick={() => set({ issueIds: openIssues.map((i) => i.id) })}
                  className="btn btn-ghost btn-sm text-action hover:bg-brand-soft"
                >
                  Vincular todas as abertas
                </button>
              )
            }
          >
            {openIssues.length === 0 ? (
              <p className="text-[12.5px] text-ink-2">Nenhuma não conformidade aberta nesta obra.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-line">
                {openIssues.map((i, idx) => (
                  <label
                    key={i.id}
                    className={`flex cursor-pointer items-center gap-3 px-3.5 py-3 transition-colors hover:bg-subtle ${idx > 0 ? "border-t border-line-2" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={rdo.issueIds.includes(i.id)}
                      disabled={locked}
                      onChange={(e) =>
                        set({
                          issueIds: e.target.checked
                            ? [...rdo.issueIds, i.id]
                            : rdo.issueIds.filter((x) => x !== i.id),
                        })
                      }
                      className="h-4 w-4 shrink-0 rounded accent-action"
                    />
                    <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink">
                      {i.mp && <IconCrosshair className="h-3.5 w-3.5 shrink-0 text-action" />}
                      {i.title}
                    </span>
                    <span className="ml-auto hidden shrink-0 text-[11.5px] text-ink-3 sm:block">{i.local}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0" onClick={(e) => e.preventDefault()}>
                      <StatusChip status={i.status} nc={i.ncStatus} />
                      <button
                        onClick={() => navigate(`${caminhoDaObra(rdo.projectId, "nao-conformidades")}?nc=${i.id}`)}
                        className="group/link inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-1 text-[11.5px] font-semibold text-action transition-colors hover:bg-brand-soft"
                      >
                        abrir a peça
                        <IconArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover/link:translate-x-0.5" />
                      </button>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Section>
        </div>

        {!locked && (
          <div className="mt-8 flex justify-end border-t border-line pt-4">
            <button
              onClick={() => { if (confirm("Excluir este RDO em rascunho?")) { remove(rdo.id); onBack(); } }}
              className="btn btn-ghost btn-sm text-danger hover:bg-danger/10"
            >
              <IconTrash className="h-4 w-4" />
              Excluir rascunho
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RdoDocument({ rdo, annex, issues, verified, onEdit }: {
  rdo: Rdo;
  annex: AnnexPhoto[];
  issues: { id: string; title: string; local: string; discipline: string; dueDate: string }[];
  /** pendências conferidas nesta visita — a prova de que a cobrança fechou o ciclo */
  verified: Issue[];
  onEdit: () => void;
}) {
  const project = projectById(rdo.projectId)!;
  const crew = rdo.crew.filter((c) => c.qty > 0);
  const equip = rdo.equipment.filter((c) => c.qty > 0);
  const total = crew.reduce((s, c) => s + c.qty, 0);
  const encobertos = annex.filter((a) => a.kind === "encoberto");
  let secN = 6; // 1..5 são fixas; as seguintes dependem do conteúdo

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 pb-14 pt-4 lg:px-8 print:max-w-none print:px-0 print:pb-0 print:pt-0">
        <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
          <button onClick={onEdit} className="btn btn-ghost btn-sm -ml-2">
            <IconArrowLeft className="h-4 w-4" />
            Editar
          </button>
          <button onClick={() => window.print()} className="btn btn-primary">
            <IconPrinter className="h-4 w-4" />
            Imprimir / PDF
          </button>
        </div>

        <div className="animate-rise rounded-3xl bg-white p-6 text-ink shadow-lg ring-1 ring-line/70 sm:p-10 print:animate-none print:rounded-none print:p-0 print:shadow-none print:ring-0">
          <header className="mb-7 border-b-2 border-ink pb-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <Wordmark className="text-[15px]" />
              <span className="rounded-full bg-brand-soft px-3 py-1 text-[11px] font-semibold text-action ring-1 ring-inset ring-[#cfe7fb] print:bg-transparent print:px-0 print:ring-0">
                Relatório Diário de Obra
              </span>
            </div>
            <h1 className="font-display text-[22px] font-bold leading-tight tracking-[-0.02em]">{project.name}</h1>
            <p className="mt-1 text-[13px] text-ink-2">{project.client} · {project.address}</p>
            <div className="mt-4 grid grid-cols-3 gap-3 rounded-2xl bg-subtle px-4 py-3.5 ring-1 ring-inset ring-line-2 print:rounded-none print:bg-transparent print:px-0 print:py-0 print:ring-0">
              <DocField label="RDO nº" value={String(rdo.number).padStart(3, "0")} mono />
              <DocField label="Data" value={fmtDate(rdo.date)} />
              <DocField label="Responsável" value={rdo.responsible} />
            </div>
          </header>

          <DocSection n="1" title="Condições do tempo">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className={TH}>Período</th>
                  <th className={TH}>Condição</th>
                  <th className={TH}>Praticabilidade</th>
                </tr>
              </thead>
              <tbody>
                {PERIODS.map((p) => (
                  <tr key={p} className="border-b border-line-2">
                    <td className="py-2 pr-2">{RDO_PERIOD_LABEL[p]}</td>
                    <td className="py-2 pr-2">{RDO_WEATHER_LABEL[rdo.weather[p]]}</td>
                    <td className="py-2">{rdo.workable[p] ? "Praticável" : "Impraticável"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DocSection>

          <DocSection n="2" title={`Efetivo em campo${total ? ` — ${total} profissionais` : ""}`}>
            {crew.length === 0 ? (
              <p className="text-[12.5px] text-ink-3">Não informado.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-x-8 text-[12.5px]">
                {crew.map((c) => (
                  <li key={c.id} className="flex justify-between gap-3 border-b border-line-2 py-1.5">
                    <span>{c.role}</span>
                    <span className="font-semibold tabular">{c.qty}</span>
                  </li>
                ))}
              </ul>
            )}
            {equip.length > 0 && (
              <>
                <p className="mb-1 mt-4 text-[11px] font-semibold text-ink-3">
                  Equipamentos
                </p>
                <ul className="grid grid-cols-2 gap-x-8 text-[12.5px]">
                  {equip.map((c) => (
                    <li key={c.id} className="flex justify-between gap-3 border-b border-line-2 py-1.5">
                      <span>{c.role}</span>
                      <span className="font-semibold tabular">{c.qty}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </DocSection>

          <DocSection n="3" title="Serviços executados">
            <DocText text={rdo.servicesExecuted} />
          </DocSection>

          <DocSection n="4" title="Ocorrências">
            <DocText text={rdo.occurrences} />
          </DocSection>

          <DocSection n="5" title="Não conformidades observadas">
            <DocText text={rdo.nonConformities} />
            {issues.length > 0 && (
              <table className="mt-3 w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    {["Não conformidade", "Local", "Disciplina", "Prazo"].map((h) => (
                      <th key={h} className={TH}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {issues.map((i) => (
                    <tr key={i.id} className="border-b border-line-2 align-top">
                      <td className="py-2 pr-2 font-medium">{i.title}</td>
                      <td className="py-2 pr-2">{i.local}</td>
                      <td className="py-2 pr-2">{i.discipline}</td>
                      <td className="py-2 tabular">{i.dueDate.split("-").reverse().join("/")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </DocSection>

          {verified.length > 0 && (
            <DocSection n={String(secN++)} title="Não conformidades verificadas nesta visita">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    {["Não conformidade", "Local", "Responsável", "Ato registrado"].map((h) => (
                      <th key={h} className={TH}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {verified.map((i) => {
                    const v = verificadaNoRdo(i, rdo.id).at(-1)!;
                    return (
                      <tr key={i.id} className="border-b border-line-2 align-top">
                        <td className="py-2 pr-2 font-medium">{i.title}</td>
                        <td className="py-2 pr-2">{i.local}</td>
                        <td className="py-2 pr-2">{i.assignee}</td>
                        <td className={`py-2 ${v.to === "sanada" ? "font-semibold text-positive" : ""}`}>
                          {NC_ACTION_LABEL[v.action]}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </DocSection>
          )}

          {rdo.notes.trim() && (
            <DocSection n={String(secN++)} title="Observações">
              <DocText text={rdo.notes} />
            </DocSection>
          )}

          {encobertos.length > 0 && (
            <DocSection n={String(secN++)} title="Registro de serviços encobertos">
              <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">
                Registro visual dos serviços fotografados antes do fechamento, para efeito de
                comprovação futura de execução.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {encobertos.map((a) => (
                  <figure key={a.id} className="break-inside-avoid">
                    <img src={a.imageDataUrl} alt="" className="w-full rounded-xl border border-line" />
                    <figcaption className="mt-1.5 text-[11px] leading-snug text-ink-2">
                      <b className="font-semibold text-ink">{a.label}</b>{a.caption ? ` — ${a.caption}` : ""}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </DocSection>
          )}

          {annex.length > 0 && (
            <DocSection n={String(secN++)} title="Anexo fotográfico — registro 360°">
              <div className="grid grid-cols-2 gap-4">
                {annex.map((a, idx) => (
                  <figure key={a.id} className="break-inside-avoid">
                    <img src={a.imageDataUrl} alt="" className="w-full rounded-xl border border-line" />
                    <figcaption className="mt-1.5 text-[10.5px] leading-snug text-ink-3">
                      <b className="font-semibold text-ink-2 tabular">Foto {String(idx + 1).padStart(2, "0")}</b>{a.label ? ` — ${a.label}` : ""}{a.kind ? ` · ${RDO_PHOTO_KIND_LABEL[a.kind]}` : ""}{a.caption ? ` — ${a.caption}` : ""} · {new Date(a.createdAt).toLocaleString("pt-BR")}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </DocSection>
          )}

          <div className="mt-12 grid grid-cols-2 gap-10 break-inside-avoid">
            {["Contratada — responsável técnico", "Fiscalização"].map((l) => (
              <div key={l}>
                <div className="h-10 border-b border-ink" />
                <p className="mt-1.5 text-[11px] font-medium text-ink-3">{l}</p>
              </div>
            ))}
          </div>

          <footer className="mt-8 border-t border-line pt-4 text-[10.5px] leading-relaxed text-ink-3">
            Relatório emitido pela plataforma Obra360.
            {rdo.aiDrafted && " Redação assistida por IA a partir do registro visual, revisada e assumida pelo responsável técnico."}
            {rdo.status === "fechado" && rdo.closedAt &&
              ` Fechado em ${new Date(rdo.closedAt).toLocaleString("pt-BR")}.`}
          </footer>
        </div>
      </div>
    </div>
  );
}

/** Cabeçalho de coluna das tabelas do documento. */
const TH = "py-2 pr-2 text-[11px] font-semibold text-ink-3";

/* ------------------------------------------------------------------ */

function Section({ title, action, icon, i = 0, children }: {
  title: string; action?: React.ReactNode; icon?: React.ReactNode; i?: number; children: React.ReactNode;
}) {
  return (
    <section className="card reveal" style={{ ["--i" as string]: Math.min(i, 12) }}>
      <div className="card-head">
        <h2 className="card-title flex min-w-0 items-center gap-2.5">
          {icon && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-action">{icon}</span>
          )}
          <span className="min-w-0">{title}</span>
        </h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block last:mb-0">
      <span className="label mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

function DocField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-ink-3">{label}</p>
      <p className={`mt-0.5 truncate text-[13px] font-semibold text-ink ${mono ? "font-mono tabular" : ""}`}>{value}</p>
    </div>
  );
}

function DocSection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-3 flex items-center gap-2.5 font-display text-[14px] font-semibold tracking-[-0.01em]">
        <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-lg bg-brand-soft px-1 text-[11.5px] font-bold text-action tabular ring-1 ring-inset ring-[#cfe7fb] print:ring-0">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function DocText({ text }: { text: string }) {
  if (!text.trim()) return <p className="text-[12.5px] text-ink-3">Nada a registrar.</p>;
  return (
    <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">{text}</p>
  );
}

function CrewTable({ rows, locked, addLabel, onChange }: {
  rows: RdoCrewRow[]; locked: boolean; addLabel: string; onChange: (rows: RdoCrewRow[]) => void;
}) {
  const patch = (id: string, p: Partial<RdoCrewRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-line">
        {rows.length === 0 && (
          <p className="px-3.5 py-3.5 text-[12.5px] text-ink-3">Nada informado.</p>
        )}
        {rows.map((r, idx) => (
          <div
            key={r.id}
            className={`flex animate-fade items-center gap-2 px-2.5 py-2 transition-colors hover:bg-subtle/70 ${idx > 0 ? "border-t border-line-2" : ""}`}
          >
            <input
              value={r.role}
              disabled={locked}
              placeholder="Função / equipamento"
              onChange={(e) => patch(r.id, { role: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[13px] text-ink transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-ink-3 hover:border-line hover:bg-white focus:border-brand focus:bg-white focus:shadow-[0_0_0_4px_rgb(0_155_255/0.12)] focus:outline-none"
            />
            <input
              type="number"
              min="0"
              value={r.qty}
              disabled={locked}
              onChange={(e) => patch(r.id, { qty: Math.max(0, parseInt(e.target.value || "0", 10)) })}
              className="field h-8 w-16 px-2 py-1 text-center tabular"
            />
            {!locked && (
              <button
                onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
                aria-label={`Remover ${r.role || "linha"}`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <IconClose className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {!locked && (
        <button
          onClick={() => onChange([...rows, { id: `r-${Date.now()}`, role: "", qty: 1 }])}
          className="btn btn-ghost btn-sm -ml-1 mt-2.5 text-action hover:bg-brand-soft"
        >
          <IconPlus className="h-4 w-4" />
          {addLabel}
        </button>
      )}
    </div>
  );
}

function StorageNotice() {
  const warning = useApp((s) => s.storageWarning);
  const clear = useApp((s) => s.clearStorageWarning);
  if (!warning) return null;
  return (
    <div className="mt-6 flex animate-pop items-start gap-3 rounded-xl bg-[#fdf4e2] px-3.5 py-3 text-[12.5px] leading-relaxed text-warn ring-1 ring-inset ring-[#efdcb0]">
      <IconAlert className="mt-px h-4 w-4 shrink-0" />
      <span className="flex-1">{warning}</span>
      <button
        onClick={clear}
        aria-label="Dispensar aviso"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-warn transition-colors hover:bg-warn/10"
      >
        <IconClose className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function BackupControls() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <span className="flex flex-wrap items-center gap-2">
      {msg && (
        <span
          key={msg}
          role="status"
          className="animate-pop rounded-full bg-brand-soft px-2.5 py-1 text-[11.5px] font-medium text-action ring-1 ring-inset ring-[#cfe7fb]"
        >
          {msg}
        </span>
      )}
      <button
        onClick={() => { exportBackup(); setMsg("Cópia baixada"); setTimeout(() => setMsg(null), 3000); }}
        title="Baixar uma cópia dos dados guardados neste navegador"
        className="btn btn-secondary"
      >
        <IconDownload className="h-4 w-4" />
        Baixar cópia
      </button>
      <button
        onClick={() => fileRef.current?.click()}
        title="Restaurar dados de uma cópia salva"
        className="btn btn-secondary"
      >
        <IconUpload className="h-4 w-4" />
        Restaurar
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            await importBackup(f);
            setMsg("Cópia restaurada");
          } catch (err) {
            setMsg(err instanceof Error ? err.message : "Falha ao restaurar");
          }
          setTimeout(() => setMsg(null), 4000);
          e.target.value = "";
        }}
      />
    </span>
  );
}
