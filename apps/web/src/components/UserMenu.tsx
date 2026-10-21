import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { useApp } from "../store";
import { NC_ROLE_LABEL } from "../types";
import { IconChevronDown, IconLogout, IconShield } from "./ui";

/** Primeira letra do nome, em maiúscula. Sem nome, um ponto de interrogação. */
function initialOf(name: string | null): string {
  const letter = name?.trim().charAt(0);
  return letter ? letter.toLocaleUpperCase("pt-BR") : "?";
}

/** Avatar da barra. O clique abre o cartão da conta, com animação. */
export default function UserMenu() {
  const user = useApp((s) => s.user);
  const email = useApp((s) => s.userEmail);
  const role = useApp((s) => s.activeRole);
  const orgName = useApp((s) => s.orgName);
  const logout = useApp((s) => s.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const initial = initialOf(user);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={user ? `Conta de ${user}` : "Conta"}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-full border bg-white py-1 pl-1 pr-2.5 shadow-xs transition hover:border-field ${open ? "border-field" : "border-line"}`}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#1b5c8f] to-[#0a2540] text-[13px] font-bold text-white ring-2 ring-white">
          {initial}
        </span>
        <span className="hidden max-w-32 truncate text-[12.5px] font-semibold text-ink md:block">{user?.split(" ")[0]}</span>
        <IconChevronDown className={`h-3.5 w-3.5 text-ink-3 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label="Conta"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full z-50 mt-2 w-72 origin-top-right overflow-hidden rounded-2xl border border-line bg-white shadow-xl"
          >
            <div className="relative overflow-hidden bg-[linear-gradient(135deg,#0e3656,#0a2540)] px-5 pb-5 pt-5 text-white">
              <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand/30 blur-2xl" />
              <div className="relative flex items-center gap-3.5">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 text-lg font-bold ring-1 ring-inset ring-white/20">
                  {initial}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{user}</p>
                  {email && <p className="truncate text-[12px] text-white/60">{email}</p>}
                </div>
              </div>
            </div>
            <div className="space-y-1 p-2">
              <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft text-action">
                  <IconShield className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11.5px] font-medium text-ink-3">Perfil de acesso</p>
                  <p className="truncate text-[13px] font-semibold text-ink">{NC_ROLE_LABEL[role]}</p>
                </div>
              </div>
              {orgName && (
                <p className="truncate px-3 pb-1 text-[11.5px] text-ink-3">{orgName}</p>
              )}
              <div className="mx-1 h-px bg-line-2" />
              <button
                type="button"
                onClick={() => { void logout().then(() => navigate("/entrar")); }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-ink-2 transition hover:bg-[#fdeeec] hover:text-danger"
              >
                <IconLogout className="h-4 w-4" />
                Sair da conta
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
