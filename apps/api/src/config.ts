/**
 * Configuração da API, lida do ambiente (arquivo `.env` em dev, nunca commitado).
 *
 * Tudo que é segredo — chaves do Supabase, chave da Anthropic — entra por
 * aqui e só por aqui. Validamos na partida para que um `.env` incompleto falhe
 * com uma frase legível, em vez de virar um 500 misterioso na primeira requisição.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Raiz do monorepo — o mesmo cálculo vale para `src/` (tsx) e `dist/` (build). */
export const REPO_ROOT = path.resolve(here, "../../..");

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3333),
  /** endereço público da API — base das URLs de arquivo devolvidas ao cliente */
  PUBLIC_URL: z.string().url().default("http://localhost:3333"),
  /** origens do navegador autorizadas (CORS com credenciais), separadas por vírgula */
  CORS_ORIGINS: z.string().default("http://localhost:5199"),

  /** Projeto Supabase: Auth, JWKS e a secret key (só no servidor). */
  SUPABASE_URL: z.string({ error: "SUPABASE_URL é obrigatória" }).url(),
  SUPABASE_PUBLISHABLE_KEY: z.string({ error: "SUPABASE_PUBLISHABLE_KEY é obrigatória" }).min(1),
  SUPABASE_SECRET_KEY: z.string({ error: "SUPABASE_SECRET_KEY é obrigatória" }).min(1),
  SUPABASE_JWKS_URL: z.string({ error: "SUPABASE_JWKS_URL é obrigatória" }).url(),

  SESSION_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: bool.default(false),

  STORAGE_ROOT: z.string().default(path.join(REPO_ROOT, "storage")),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),

  REDIS_URL: z.string().optional(),

  /** "hoje" do negócio (prazos, vencidas). Fixo só para demonstração; vazio = data real. */
  OBRA360_TODAY: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "OBRA360_TODAY deve ser aaaa-mm-dd").optional(),
  APP_TZ: z.string().default("America/Maceio"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // `.env` com `CHAVE=` (vazio) significa "não configurado", não "string vazia"
  const clean = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const parsed = Env.safeParse(clean);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Configuração inválida da API:\n${lines.join("\n")}`);
  }
  const cfg = parsed.data;
  cfg.STORAGE_ROOT = path.resolve(REPO_ROOT, cfg.STORAGE_ROOT);
  return cfg;
}

export const corsOrigins = (cfg: Config) =>
  cfg.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
