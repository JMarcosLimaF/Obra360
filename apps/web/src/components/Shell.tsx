import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { fmtDate } from "../data/catalog";
import { isOverdue } from "../lib/nc-flow";
import { caminhoDaObra, obraPeloTrecho } from "../obra";
import { useApp } from "../store";
import type { Project } from "../types";
import { NC_ROLE_LABEL } from "../types";
import ProjectThumb from "./ProjectThumb";
import {
  IconAlert,
  IconBook,
  IconBriefcase,
  IconBuilding,
  IconChevronRight,
  IconChevronsUpDown,
  IconCheck,
  IconFileText,
  IconGrid,
  IconLayers,
  IconMenu,
  IconRotate360,
  IconSidebar,
  LogoMark,
  ProgressBar,
  ProgressRing,
  Wordmark,
} from "./ui";
import UserMenu from "./UserMenu";

type Icon = ComponentType<{ className?: string }>;
type Item = { page: string; label: string; icon: Icon; end?: boolean; badge?: "ncs" | "rdos" };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Obra",
    items: [
      { page: "", label: "Painel", icon: IconGrid, end: true },
      { page: "tour", label: "Tour 360", icon: IconRotate360 },
      { page: "plantas", label: "Plantas", icon: IconLayers },
    ],
  },
  {
    title: "Fiscalização",
    items: [
      { page: "nao-conformidades", label: "Não conformidades", icon: IconAlert, badge: "ncs" },
      { page: "diario", label: "Diário de obra", icon: IconBook, badge: "rdos" },
    ],
  },
  {
    title: "Gestão",
    items: [
      { page: "relatorios", label: "Relatórios", icon: IconFileText },
      { page: "contrato", label: "Contrato", icon: IconBriefcase },
    ],
  },
];

const PAGE_LABEL: Record<string, string> = {
  tour: "Tour 360",
  plantas: "Plantas",
  "nao-conformidades": "Não conformidades",
  ocorrencias: "Ocorrências",
  diario: "Diário de obra",
  relatorios: "Relatórios",
  contrato: "Contrato",
};

const COLLAPSE_KEY = "obra360.sidebar.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/** A obra aberta, lida do endereço — o layout fica acima da rota da obra. */
function useCurrentProject(): { project: Project | null; page: string } {
  const match = useMatch("/obras/:obra/*");
  const project = match?.params.obra ? obraPeloTrecho(match.params.obra) ?? null : null;
  const page = (match?.params["*"] ?? "").split("/")[0];
  return { project, page };
}

/** Moldura do app: barra lateral flutuante em navy e área de trabalho ao lado. */
export default function Shell() {
  const { pathname } = useLocation();
  const { project, page } = useCurrentProject();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* armazenamento indisponível: só não lembra */
    }
  }, [collapsed]);

  useEffect(() => setMobileOpen(false), [pathname]);

  const isVisit = pathname.includes("/visita");

  return (
    <div className="app-shell app-canvas flex h-screen overflow-hidden">
      {/* desktop */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 80 : 268 }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        className="relative z-30 hidden shrink-0 p-3 pr-0 lg:block"
      >
        <SidebarBody project={project} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      </motion.aside>

      {/* mobile: gaveta */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-navy-950/40 backdrop-blur-[2px] lg:hidden"
            />
            <motion.aside
              key="drawer"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              className="fixed inset-y-0 left-0 z-50 w-[280px] p-3 lg:hidden"
            >
              <SidebarBody project={project} collapsed={false} onToggle={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 px-4 lg:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
            className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-white text-ink-2 shadow-xs lg:hidden"
          >
            <IconMenu className="h-[18px] w-[18px]" />
          </button>
          <Breadcrumb project={project} page={isVisit ? "visita" : page} />
          <div className="ml-auto flex items-center gap-3">
            <RoleBadge />
            <UserMenu />
          </div>
        </header>
        <main className="relative min-h-0 flex-1 overflow-hidden lg:mb-3 lg:ml-3 lg:mr-3 lg:rounded-[22px]">
          <div key={pathname} className="h-full animate-page">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function Breadcrumb({ project, page }: { project: Project | null; page: string }) {
  const label = page === "visita" ? "Visita guiada" : PAGE_LABEL[page] ?? (project ? "Painel" : "");
  return (
    <nav aria-label="Trilha" className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <Link to="/obras" className="shrink-0 rounded-lg px-1.5 py-1 font-medium text-ink-3 transition hover:bg-ink/5 hover:text-ink">
        Obras
      </Link>
      {project && (
        <>
          <IconChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3/60" />
          <Link
            to={caminhoDaObra(project.id)}
            className="hidden min-w-0 truncate rounded-lg px-1.5 py-1 font-medium text-ink-3 transition hover:bg-ink/5 hover:text-ink sm:block"
          >
            {project.name}
          </Link>
          <IconChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-ink-3/60 sm:block" />
          <span className="truncate px-1.5 py-1 font-semibold text-ink">{label}</span>
        </>
      )}
    </nav>
  );
}

function RoleBadge() {
  const role = useApp((s) => s.activeRole);
  return (
    <span className="hidden items-center gap-2 rounded-full border border-line bg-white/80 py-1 pl-2 pr-3 text-[12px] font-semibold text-ink-2 shadow-xs backdrop-blur sm:inline-flex">
      <span className="relative grid h-2 w-2 place-items-center">
        <span className="absolute h-2 w-2 animate-ping rounded-full bg-emerald-400/60" />
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {NC_ROLE_LABEL[role]}
    </span>
  );
}

function SidebarBody({
  project,
  collapsed,
  onToggle,
}: {
  project: Project | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const issues = useApp((s) => s.issues);
  const rdos = useApp((s) => s.rdos);
  const projects = useApp((s) => s.projects);

  const counts = project
    ? {
        ncs: issues.filter((i) => i.projectId === project.id && i.status !== "resolvido").length,
        overdue: issues.filter((i) => i.projectId === project.id && isOverdue(i)).length,
        rdos: rdos.filter((r) => r.projectId === project.id).length,
      }
    : null;

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-[22px] bg-[linear-gradient(180deg,#0e3656_0%,#0a2540_55%,#071d33_100%)] text-white shadow-xl ring-1 ring-white/5">
      {/* textura: grade de prancha e brilho da marca */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] bg-[size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_240px)]" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 animate-float rounded-full bg-brand/25 blur-3xl" />

      <div className={`relative flex h-16 shrink-0 items-center ${collapsed ? "justify-center" : "justify-between pl-4 pr-3"}`}>
        <Link to="/obras" className="flex items-center gap-2.5" title="Obra360">
          <LogoMark className="h-8 w-8" />
          {!collapsed && <Wordmark light className="text-[17px]" />}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Recolher menu"
            className="grid h-8 w-8 place-items-center rounded-lg text-white/45 transition hover:bg-white/10 hover:text-white"
          >
            <IconSidebar className="h-[17px] w-[17px]" />
          </button>
        )}
      </div>

      <div className={`relative ${collapsed ? "px-3" : "px-3"}`}>
        <ProjectSwitcher project={project} projects={projects} collapsed={collapsed} />
      </div>

      <LayoutGroup id="sidebar">
        <nav className="relative mt-3 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 [scrollbar-width:none]">
          {project ? (
            GROUPS.map((g) => (
              <div key={g.title} className="mt-3 first:mt-1">
                {!collapsed ? (
                  <p className="px-3 pb-1.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/35">{g.title}</p>
                ) : (
                  <div className="mx-auto my-2.5 h-px w-6 bg-white/10" />
                )}
                <div className="flex flex-col gap-0.5">
                  {g.items.map((it) => (
                    <NavItem
                      key={it.page}
                      to={caminhoDaObra(project.id, it.page)}
                      end={it.end}
                      icon={it.icon}
                      label={it.label}
                      collapsed={collapsed}
                      badge={
                        it.badge === "ncs" && counts?.ncs
                          ? { n: counts.ncs, tone: counts.overdue ? "danger" : "muted" }
                          : it.badge === "rdos" && counts?.rdos
                            ? { n: counts.rdos, tone: "muted" }
                            : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="mt-1">
              {!collapsed && (
                <p className="px-3 pb-1.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/35">Geral</p>
              )}
              <NavItem to="/obras" end icon={IconBuilding} label="Todas as obras" collapsed={collapsed} badge={{ n: projects.length, tone: "muted" }} />
              {!collapsed && (
                <p className="px-3 pb-1.5 pt-5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/35">Acesso rápido</p>
              )}
              <div className="flex flex-col gap-0.5">
                {projects.map((p) => (
                  <Link
                    key={p.id}
                    to={caminhoDaObra(p.id)}
                    title={collapsed ? p.name : undefined}
                    className={`group flex items-center gap-3 rounded-xl py-2 text-[13px] font-medium text-white/65 transition hover:bg-white/[0.06] hover:text-white ${collapsed ? "justify-center px-0" : "px-2.5"}`}
                  >
                    <ProjectThumb project={p} className="h-7 w-7 rounded-lg" textClass="text-[10px]" />
                    {!collapsed && <span className="truncate">{p.name}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </nav>
      </LayoutGroup>

      {project && (
        <div className="relative shrink-0 p-3 pt-0">
          {collapsed ? (
            <div className="flex justify-center py-1" title={`Avanço físico ${project.progressPct}%`}>
              <ProgressRing value={project.progressPct} size={40} stroke={4} track="rgb(255 255 255 / 0.12)">
                <span className="text-[10px] font-bold tabular">{project.progressPct}</span>
              </ProgressRing>
            </div>
          ) : (
            <div className="rounded-2xl bg-white/[0.06] p-3.5 ring-1 ring-inset ring-white/10">
              <div className="flex items-baseline justify-between">
                <span className="text-[11.5px] font-medium text-white/55">Avanço físico</span>
                <span className="text-[15px] font-bold tabular">{project.progressPct}%</span>
              </div>
              <ProgressBar value={project.progressPct} tone="light" className="mt-2" />
              <p className="mt-2 text-[11px] text-white/40">Entrega prevista {fmtDate(project.plannedEnd)}</p>
            </div>
          )}
        </div>
      )}

      {collapsed && (
        <div className="relative flex shrink-0 justify-center pb-3">
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expandir menu"
            className="grid h-9 w-9 place-items-center rounded-xl text-white/45 transition hover:bg-white/10 hover:text-white"
          >
            <IconSidebar className="h-[17px] w-[17px] rotate-180" />
          </button>
        </div>
      )}
    </div>
  );
}

function NavItem({
  to,
  end,
  icon: Icon,
  label,
  collapsed,
  badge,
}: {
  to: string;
  end?: boolean;
  icon: Icon;
  label: string;
  collapsed: boolean;
  badge?: { n: number; tone: "danger" | "muted" };
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `group relative flex h-10 items-center gap-3 rounded-xl text-[13px] font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-brand/60 ${
          collapsed ? "justify-center px-0" : "px-3"
        } ${isActive ? "text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white"}`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="nav-active"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
              className="absolute inset-0 rounded-xl bg-gradient-to-r from-white/[0.14] to-white/[0.06] shadow-[0_1px_0_rgb(255_255_255/0.08)_inset] ring-1 ring-inset ring-white/10"
            >
              <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-x-[3px] -translate-y-1/2 rounded-full bg-brand shadow-[0_0_12px_2px_rgb(0_155_255/0.6)]" />
            </motion.span>
          )}
          <Icon className={`relative h-[18px] w-[18px] shrink-0 transition-transform duration-300 group-hover:scale-110 ${isActive ? "text-[#5cc4ff]" : ""}`} />
          {!collapsed && <span className="relative truncate">{label}</span>}
          {badge && !collapsed && (
            <span
              className={`relative ml-auto min-w-[22px] rounded-full px-1.5 py-px text-center text-[10.5px] font-bold tabular ${
                badge.tone === "danger" ? "bg-[#e5484d] text-white shadow-[0_0_0_3px_rgb(229_72_77/0.18)]" : "bg-white/10 text-white/75"
              }`}
            >
              {badge.n}
            </span>
          )}
          {badge && collapsed && badge.tone === "danger" && (
            <span className="absolute right-2.5 top-2 h-2 w-2 rounded-full bg-[#e5484d] ring-2 ring-[#0b2a47]" />
          )}
        </>
      )}
    </NavLink>
  );
}

function ProjectSwitcher({
  project,
  projects,
  collapsed,
}: {
  project: Project | null;
  projects: Project[];
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!project) {
    return collapsed ? null : (
      <div className="rounded-2xl bg-white/[0.06] px-3.5 py-3 ring-1 ring-inset ring-white/10">
        <p className="text-[11.5px] font-medium text-white/50">Carteira</p>
        <p className="text-[13.5px] font-semibold">
          {projects.length} obra{projects.length === 1 ? "" : "s"} em acompanhamento
        </p>
      </div>
    );
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={collapsed ? project.name : undefined}
        className={`flex w-full items-center gap-3 rounded-2xl text-left ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.09] ${
          open ? "bg-white/[0.1]" : "bg-white/[0.06]"
        } ${collapsed ? "justify-center p-1.5" : "p-2"}`}
      >
        <ProjectThumb project={project} className="h-10 w-10 rounded-xl" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight">{project.name}</span>
              <span className="mt-0.5 block truncate text-[11px] text-white/45">{project.client}</span>
            </span>
            <IconChevronsUpDown className="mr-1 h-4 w-4 shrink-0 text-white/40" />
          </>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute top-full z-50 mt-2 w-[260px] origin-top-left overflow-hidden rounded-2xl border border-line bg-white p-1.5 text-ink shadow-xl ${collapsed ? "left-0" : "left-0 right-0 w-auto"}`}
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-ink-3">Trocar de obra</p>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate(caminhoDaObra(p.id));
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition hover:bg-subtle"
              >
                <ProjectThumb project={p} className="h-8 w-8 rounded-lg" textClass="text-[10.5px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold">{p.name}</span>
                  <span className="block truncate text-[11px] text-ink-3">{p.progressPct}% executado</span>
                </span>
                {p.id === project.id && <IconCheck className="h-4 w-4 text-brand" />}
              </button>
            ))}
            <div className="my-1 h-px bg-line-2" />
            <Link
              to="/obras"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[12.5px] font-semibold text-action transition hover:bg-brand-soft"
            >
              <IconBuilding className="h-4 w-4" />
              Ver todas as obras
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Tela de espera com a marca. */
export function Splash({ label }: { label: ReactNode }) {
  return (
    <div className="app-canvas grid h-screen place-items-center">
      <div className="flex flex-col items-center gap-4 animate-fade">
        <div className="relative">
          <span className="absolute inset-0 animate-ping rounded-[14px] bg-brand/25" />
          <LogoMark className="relative h-12 w-12 rounded-[14px]" />
        </div>
        <p className="text-[13px] font-medium text-ink-2">{label}</p>
        <div className="h-1 w-40 overflow-hidden rounded-full bg-ink/[0.06]">
          <div className="skeleton h-full w-full rounded-full bg-[linear-gradient(90deg,transparent_0%,#009bff_50%,transparent_100%)]" />
        </div>
      </div>
    </div>
  );
}
