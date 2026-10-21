import { useEffect, useRef, useState, type ReactNode } from "react";
import type { IssueStatus, NcStatus } from "../types";
import { ISSUE_STATUS_LABEL, NC_STATUS_LABEL } from "../types";

/* Chips de status — pílula com ponto, fundo suave e contorno interno */
const CHIP: Record<IssueStatus, string> = {
  aberto: "bg-[#fdeeec] text-[#b4352a] ring-[#f5d0cb]",
  em_execucao: "bg-[#fdf4e2] text-[#8a5a0b] ring-[#efdcb0]",
  aguardando_verificacao: "bg-[#e9f4fd] text-[#0a67a6] ring-[#c6e1f5]",
  resolvido: "bg-[#e8f6ed] text-[#1f7a43] ring-[#c4e5d0]",
};

/** Cor do chip pelo estado do trâmite, reaproveitando a paleta acima. */
const NC_CHIP: Record<NcStatus, IssueStatus> = {
  rascunho: "aberto",
  notificada: "aberto",
  ciente: "aberto",
  em_reparo: "em_execucao",
  reparo_submetido: "aguardando_verificacao",
  contestada: "aberto",
  sanada: "resolvido",
  cancelada: "resolvido",
};

/**
 * Um único chip para o sistema inteiro.
 *
 * Quando a peça já está no trâmite formal, o rótulo é o do trâmite — "Reparo
 * submetido" e não "Aguard. verificação". Ter dois vocabulários para o mesmo
 * item obrigava o usuário a traduzir de cabeça entre uma tela e outra.
 */
export function StatusChip({ status, nc }: { status: IssueStatus; nc?: NcStatus }) {
  const cor = CHIP[nc ? NC_CHIP[nc] : status];
  const rotulo = nc ? NC_STATUS_LABEL[nc] : ISSUE_STATUS_LABEL[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-semibold ring-1 ring-inset ${cor}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {rotulo}
    </span>
  );
}

/* Rótulo pequeno de metadado */
export function Micro({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`text-[11.5px] font-medium text-ink-3 ${className}`}>{children}</span>;
}

/** Cabeçalho de página: título, apoio e ações à direita. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className = "",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-4 ${className}`}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[12px] font-semibold text-brand">{eyebrow}</div>}
        <h1 className="font-display text-[26px] font-bold leading-tight tracking-[-0.025em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Estado vazio com ícone em pastilha. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center px-6 py-10 text-center ${className}`}>
      {icon && (
        <div className="relative mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-b from-brand-soft to-white text-action ring-1 ring-inset ring-[#d4ebfb]">
          {icon}
        </div>
      )}
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {children && <div className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Número que sobe de 0 até o valor ao aparecer. */
export function CountUp({ value, duration = 900, className }: { value: number; duration?: number; className?: string }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(Math.round(origin + (value - origin) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={`tabular ${className ?? ""}`}>{shown}</span>;
}

/** Anel de progresso que se desenha ao montar. */
export function ProgressRing({
  value,
  size = 56,
  stroke = 5,
  className = "",
  track = "rgb(14 54 86 / 0.08)",
  color = "url(#ring-grad)",
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  track?: string;
  color?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(Math.max(0, Math.min(100, value))));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38b6ff" />
            <stop offset="100%" stopColor="#0a72d1" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (drawn / 100) * c}
          style={{ transition: "stroke-dashoffset 1.3s cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center">{children}</div>}
    </div>
  );
}

/** Barra de progresso que cresce da esquerda ao montar. */
export function ProgressBar({ value, className = "", tone = "brand" }: { value: number; className?: string; tone?: "brand" | "light" }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full ${tone === "light" ? "bg-white/15" : "bg-ink/[0.07]"} ${className}`}>
      <div
        className="h-full origin-left animate-grow-x rounded-full bg-gradient-to-r from-[#38b6ff] to-action"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* Ícones de traço — grade 24, sem emoji */
type IconProps = { className?: string };
const base = (className?: string) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: className ?? "h-4 w-4",
  "aria-hidden": true,
});

export const IconCrosshair = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="6.5" />
    <line x1="12" y1="2" x2="12" y2="5.5" />
    <line x1="12" y1="18.5" x2="12" y2="22" />
    <line x1="2" y1="12" x2="5.5" y2="12" />
    <line x1="18.5" y1="12" x2="22" y2="12" />
  </svg>
);

export const IconSpark = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 3l1.9 5.4L19.4 10l-5.5 1.9L12 17.4l-1.9-5.5L4.6 10l5.5-1.6L12 3z" />
  </svg>
);

export const IconPolygon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 3.5l8 5.8-3 9.2H7l-3-9.2 8-5.8z" />
    <circle cx="12" cy="3.5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="20" cy="9.3" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="17" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="7" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="4" cy="9.3" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const IconRotate360 = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 12a8 8 0 1 1 2.4 5.7" />
    <path d="M4 18v-4.5h4.5" />
  </svg>
);

export const IconReport = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M14 3h7v7" />
    <path d="M21 3l-9 9" />
    <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
  </svg>
);

export const IconLayers = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 14l9 5 9-5" />
  </svg>
);

export const IconChevronDown = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IconChevronRight = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const IconChevronsUpDown = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M8 9l4-4 4 4" />
    <path d="M8 15l4 4 4-4" />
  </svg>
);

export const IconArrowRight = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </svg>
);

export const IconArrowUpRight = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M7 17L17 7" />
    <path d="M8 7h9v9" />
  </svg>
);

export const IconGear = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1.02-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.02H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
  </svg>
);

export const IconClose = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

export const IconGrid = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </svg>
);

export const IconBuilding = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 21V8l6-4v17M10 21V10h10v11M2 21h20" />
    <path d="M13 13h1M16.5 13h1M13 16.5h1M16.5 16.5h1M6.5 10.5h1M6.5 14h1M6.5 17.5h1" />
  </svg>
);

export const IconAlert = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M10.3 3.9L2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconBook = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15z" />
    <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
    <path d="M9 7.5h6M9 11h4" />
  </svg>
);

export const IconFileText = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h4" />
  </svg>
);

export const IconBriefcase = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="3" y="7" width="18" height="13" rx="2.5" />
    <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
    <path d="M3 12.5h18" />
  </svg>
);

export const IconMenu = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);

export const IconSidebar = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16" />
  </svg>
);

export const IconSearch = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </svg>
);

export const IconPlus = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconCheck = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const IconClock = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const IconMapPin = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 21s-6.5-5.4-6.5-11a6.5 6.5 0 0 1 13 0c0 5.6-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </svg>
);

export const IconCamera = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

export const IconTrendUp = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </svg>
);

export const IconLogout = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 16l-4-4 4-4" />
    <path d="M6 12h10" />
  </svg>
);

export const IconShield = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6L12 3z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

/** Símbolo: prisma isométrico com a órbita 360 em volta. */
export function LogoMark({ className = "h-8 w-8" }: IconProps) {
  return (
    <span className={`relative grid shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#2bb0ff] via-[#0a84e6] to-[#0e3656] shadow-[0_1px_0_rgb(255_255_255/0.35)_inset,0_6px_16px_-6px_rgb(0_155_255/0.7)] ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" className="h-[62%] w-[62%]" aria-hidden>
        <path d="M12 4.5l6 3.4v7.2l-6 3.4-6-3.4V7.9l6-3.4z" fill="white" fillOpacity="0.18" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M6 7.9l6 3.4 6-3.4M12 11.3v7.2" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
        <ellipse cx="12" cy="12" rx="10.2" ry="3.6" stroke="white" strokeOpacity="0.75" strokeWidth="1.2" transform="rotate(-18 12 12)" />
      </svg>
    </span>
  );
}

export function Wordmark({ className = "text-sm", light = false }: IconProps & { light?: boolean }) {
  return (
    <span className={`font-display font-extrabold tracking-[-0.02em] ${light ? "text-white" : "text-ink"} ${className}`}>
      Obra<span className={light ? "text-[#5cc4ff]" : "text-brand"}>360</span>
    </span>
  );
}
