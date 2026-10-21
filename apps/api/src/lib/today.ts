import type { Config } from "../config.ts";

/**
 * O "hoje" do negócio — é contra ele que prazo vence. Por padrão é a data real
 * no fuso da obra; OBRA360_TODAY fixa a data para a demonstração (a carga de
 * exemplo foi escrita em torno de 30/08/2026). O cliente recebe este valor na
 * sessão e conta os dias com ele, para tela e servidor nunca discordarem.
 */
export function businessToday(cfg: Pick<Config, "OBRA360_TODAY" | "APP_TZ">, at = new Date()): string {
  if (cfg.OBRA360_TODAY) return cfg.OBRA360_TODAY;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: cfg.APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
