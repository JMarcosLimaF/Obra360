import { useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { fmtDate, levelsOf } from "../data/catalog";
import { caminhoDaObra } from "../obra";
import { useApp } from "../store";
import { fileToDataUrl } from "../lib/image";
import { thumbUrl } from "../lib/matterport";
import { isOverdue } from "../lib/nc-flow";
import type { Project } from "../types";
import NewProjectWizard from "../components/NewProjectWizard";
import {
  CountUp,
  EmptyState,
  IconAlert,
  IconArrowRight,
  IconBuilding,
  IconCamera,
  IconLayers,
  IconMapPin,
  IconPlus,
  IconRotate360,
  IconSearch,
  IconTrendUp,
  ProgressRing,
} from "../components/ui";

/** Foto da obra: a capa enviada para ela; sem capa, a do modelo Matterport
 *  vinculado; sem nenhuma (ou se as imagens falharem), um fundo de prancha
 *  com a marca. */
function ProjectCover({ project }: { project: Project }) {
  const [failed, setFailed] = useState<string[]>([]);
  const src = [project.coverUrl, project.matterportId && thumbUrl(project.matterportId)]
    .find((s): s is string => !!s && !failed.includes(s));
  return (
    <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(160deg,#164a75,#0a2540)]">
      {src ? (
        <img
          key={src}
          src={src}
          alt={`Foto da obra ${project.name}`}
          loading="lazy"
          onError={() => setFailed((f) => [...f, src])}
          className="absolute inset-0 h-full w-full object-cover transition duration-700 ease-out-expo group-hover:scale-[1.06]"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(rgb(255_255_255/0.06)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.06)_1px,transparent_1px)] bg-[size:24px_24px] text-white/30">
          <IconBuilding className="mb-10 h-14 w-14 transition duration-700 ease-out-expo group-hover:scale-110" />
        </div>
      )}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(6_26_46/0.05)_30%,rgb(6_26_46/0.82)_100%)]" />
    </div>
  );
}

/** Envio da foto de capa. Fica fora do botão do card, por cima da foto, para
 *  o clique não abrir a obra; no desktop só aparece com o mouse sobre o card. */
function CoverUpload({ project }: { project: Project }) {
  const setProjectCover = useApp((s) => s.setProjectCover);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(file: File) {
    setBusy(true);
    setError(null);
    try {
      setError(await setProjectCover(project.id, await fileToDataUrl(file)));
    } catch {
      setError("Não foi possível ler a foto.");
    } finally {
      setBusy(false);
    }
  }

  const sempreVisivel = busy || error;
  return (
    <div className="absolute left-4 top-4 z-10 flex max-w-[calc(100%-2rem)] flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        title={project.coverUrl ? "Trocar a foto da obra" : "Enviar uma foto da obra"}
        className={`flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[11.5px] font-semibold text-white ring-1 ring-inset ring-white/25 backdrop-blur-md transition duration-300 hover:bg-white/25 focus-visible:opacity-100 ${sempreVisivel ? "" : "sm:-translate-y-1 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100"}`}
      >
        <IconCamera className="h-3.5 w-3.5" />
        {busy ? "Enviando…" : project.coverUrl ? "Trocar foto" : "Enviar foto"}
      </button>
      {error && (
        <span role="alert" className="rounded-lg bg-danger px-2.5 py-1 text-[11px] leading-snug text-white">
          {error}
        </span>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void enviar(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function saudacao(): string {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export default function Projects() {
  const navigate = useNavigate();
  const issues = useApp((s) => s.issues);
  const projects = useApp((s) => s.projects);
  const captures = useApp((s) => s.captures);
  const orgName = useApp((s) => s.orgName);
  const user = useApp((s) => s.user);
  // a API confere de novo; aqui só não oferece o envio a quem não pode
  const podeTrocarCapa = useApp((s) => s.activeRole === "fiscalizacao" || s.activeRole === "gestor");
  const [busca, setBusca] = useState("");
  const [novaObra, setNovaObra] = useState(false);

  const linhas = useMemo(
    () =>
      projects.map((p) => {
        const lvls = levelsOf(p.id);
        const caps = captures.filter((c) => lvls.some((l) => l.id === c.levelId));
        const last = caps.map((c) => c.date).sort().at(-1);
        const mine = issues.filter((i) => i.projectId === p.id);
        const open = mine.filter((i) => i.status !== "resolvido").length;
        const overdue = mine.filter((i) => isOverdue(i)).length;
        return { p, lvls, caps, last, open, overdue };
      }),
    [projects, captures, issues],
  );

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const visiveis = termo
    ? linhas.filter(({ p }) => `${p.name} ${p.client} ${p.address}`.toLocaleLowerCase("pt-BR").includes(termo))
    : linhas;

  const totalOpen = linhas.reduce((n, l) => n + l.open, 0);
  const totalOverdue = linhas.reduce((n, l) => n + l.overdue, 0);
  const totalCaps = linhas.reduce((n, l) => n + l.caps.length, 0);
  const avgProgress = linhas.length ? Math.round(linhas.reduce((n, l) => n + l.p.progressPct, 0) / linhas.length) : 0;
  const firstName = user?.split(" ")[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="relative">
        <div className="blueprint pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
        <div className="relative mx-auto max-w-7xl px-5 pb-14 pt-4 lg:px-8">
          {/* boas-vindas */}
          <div className="reveal flex flex-wrap items-end justify-between gap-6" style={{ ["--i" as string]: 0 }}>
            <div>
              <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#cfe7fb] bg-brand-soft/80 px-3 py-1 text-[11.5px] font-semibold text-action">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                {orgName || "Carteira de obras"}
              </p>
              <h1 className="font-display text-[32px] font-bold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[36px]">
                {saudacao()}{firstName ? `, ${firstName}` : ""}.
              </h1>
              <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-2">
                Acompanhe o avanço, as não conformidades e o registro 360° de cada obra em um só lugar.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
              <label className="relative w-full sm:w-72">
                <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar obra, órgão ou endereço"
                  className="field h-11 rounded-2xl pl-10"
                />
              </label>
              <button type="button" onClick={() => setNovaObra(true)} className="btn btn-lg btn-primary group">
                <IconPlus className="h-[18px] w-[18px] transition-transform duration-300 group-hover:rotate-90" />
                Nova obra
              </button>
            </div>
          </div>

          {/* indicadores da carteira */}
          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <Stat i={1} icon={<IconBuilding className="h-[18px] w-[18px]" />} label="Obras acompanhadas" value={projects.length} />
            <Stat i={2} icon={<IconTrendUp className="h-[18px] w-[18px]" />} label="Avanço físico médio" value={avgProgress} suffix="%" />
            <Stat
              i={3}
              icon={<IconAlert className="h-[18px] w-[18px]" />}
              label="Não conformidades abertas"
              value={totalOpen}
              tone={totalOverdue ? "danger" : "default"}
              foot={totalOverdue ? `${totalOverdue} com prazo vencido` : "nenhuma vencida"}
            />
            <Stat i={4} icon={<IconRotate360 className="h-[18px] w-[18px]" />} label="Capturas 360°" value={totalCaps} />
          </div>

          {/* obras */}
          <div className="reveal mb-4 mt-10 flex items-center justify-between" style={{ ["--i" as string]: 5 }}>
            <h2 className="text-[17px] font-bold tracking-[-0.015em] text-ink">
              Suas obras <span className="ml-1 font-semibold text-ink-3">{visiveis.length}</span>
            </h2>
          </div>

          {visiveis.length === 0 ? (
            <div className="card">
              <EmptyState icon={<IconSearch className="h-6 w-6" />} title="Nenhuma obra encontrada">
                Nada corresponde a “{busca}”. Tente outro nome, órgão ou endereço.
              </EmptyState>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {visiveis.map(({ p, lvls, caps, last, open, overdue }, idx) => (
                <div key={p.id} className="reveal group relative" style={{ ["--i" as string]: idx + 6 }}>
                  <button
                    onClick={() => navigate(caminhoDaObra(p.id))}
                    className="flex h-full w-full flex-col overflow-hidden rounded-[26px] border border-line/80 bg-white text-left shadow-sm transition-[translate,scale,box-shadow,border-color] duration-500 ease-out-expo hover:-translate-y-1 hover:border-[#c9def0] hover:shadow-xl"
                  >
                    <div className="relative h-56 w-full shrink-0 sm:h-60">
                      <ProjectCover project={p} />
                      <div className="absolute right-4 top-4 flex gap-2">
                        {open > 0 && (
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold backdrop-blur-md ${overdue ? "bg-[#e5484d]/90 text-white" : "bg-white/85 text-ink"}`}>
                            <IconAlert className="h-3.5 w-3.5" />
                            {open} NC{open === 1 ? "" : "s"}{overdue ? ` · ${overdue} vencida${overdue === 1 ? "" : "s"}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                        <p className="mb-1 truncate text-[12px] font-medium text-white/70">{p.client}</p>
                        <h3 className="font-display text-[21px] font-bold leading-tight tracking-[-0.02em] [text-shadow:0_2px_12px_rgb(0_0_0/0.25)]">
                          {p.name}
                        </h3>
                      </div>
                    </div>

                    <div className="flex flex-1 flex-col gap-5 p-5">
                      <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2">
                        <IconMapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
                        {p.address}
                      </p>

                      <div className="flex items-center gap-4 rounded-2xl bg-subtle p-3.5 ring-1 ring-inset ring-line-2">
                        <ProgressRing value={p.progressPct} size={54} stroke={5}>
                          <span className="text-[12.5px] font-bold tabular text-ink">{p.progressPct}%</span>
                        </ProgressRing>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium text-ink-3">Avanço físico</p>
                          <p className="text-[13.5px] font-semibold text-ink">Entrega prevista {fmtDate(p.plannedEnd)}</p>
                        </div>
                      </div>

                      <dl className="grid grid-cols-3 gap-3">
                        <Mini icon={<IconLayers className="h-3.5 w-3.5" />} label="Pavimentos" value={lvls.length} />
                        <Mini icon={<IconRotate360 className="h-3.5 w-3.5" />} label="Capturas" value={caps.length} />
                        <Mini icon={<IconCamera className="h-3.5 w-3.5" />} label="Última" value={last ? fmtDate(last).slice(0, 5) : "—"} />
                      </dl>

                      <div className="mt-auto flex items-center justify-between border-t border-line-2 pt-4">
                        <span className={`text-[12.5px] font-medium ${overdue ? "text-danger" : open ? "text-ink-2" : "text-positive"}`}>
                          {open === 0 ? "Sem pendências abertas" : `${open} não conformidade${open === 1 ? "" : "s"} em aberto`}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-action">
                          Abrir painel
                          <IconArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                        </span>
                      </div>
                    </div>
                  </button>
                  {podeTrocarCapa && <CoverUpload project={p} />}
                </div>
              ))}
              {!termo && (
                <button
                  type="button"
                  onClick={() => setNovaObra(true)}
                  className="reveal group flex min-h-[280px] flex-col items-center justify-center gap-4 rounded-[26px] border-2 border-dashed border-field/80 bg-white/40 p-8 text-center transition duration-300 hover:border-brand hover:bg-brand-soft/40"
                  style={{ ["--i" as string]: visiveis.length + 6 }}
                >
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-action shadow-sm ring-1 ring-line transition duration-500 ease-out-expo group-hover:scale-110 group-hover:bg-brand group-hover:text-white group-hover:ring-brand">
                    <IconPlus className="h-6 w-6 transition-transform duration-500 group-hover:rotate-90" />
                  </span>
                  <span>
                    <span className="block text-[15px] font-bold text-ink">Cadastrar nova obra</span>
                    <span className="mt-1 block max-w-xs text-[12.5px] leading-relaxed text-ink-3">
                      Dados, pavimentos, contratada, contrato e tour 360 em poucos passos.
                    </span>
                  </span>
                </button>
              )}
            </div>
          )}
          <NewProjectWizard open={novaObra} onClose={() => setNovaObra(false)} />
        </div>
      </div>
    </div>
  );
}

function Stat({
  i,
  icon,
  label,
  value,
  suffix,
  foot,
  tone = "default",
}: {
  i: number;
  icon: ReactNode;
  label: string;
  value: number;
  suffix?: string;
  foot?: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="card card-hover reveal relative overflow-hidden p-4 sm:p-5" style={{ ["--i" as string]: i }}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium leading-snug text-ink-3">{label}</p>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone === "danger" ? "bg-[#fdeeec] text-danger" : "bg-brand-soft text-action"}`}>
          {icon}
        </span>
      </div>
      <p className={`mt-2 font-display text-[30px] font-bold leading-none tracking-[-0.03em] ${tone === "danger" ? "text-danger" : "text-ink"}`}>
        <CountUp value={value} />
        {suffix && <span className="ml-0.5 text-[20px]">{suffix}</span>}
      </p>
      {foot && <p className={`mt-2 text-[11.5px] font-medium ${tone === "danger" ? "text-danger/80" : "text-ink-3"}`}>{foot}</p>}
    </div>
  );
}

function Mini({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-3">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-[15px] font-bold tabular text-ink">{value}</dd>
    </div>
  );
}
