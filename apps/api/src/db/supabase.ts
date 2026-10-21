/**
 * Cliente do Supabase. Não há conexão própria com o Postgres: a API usa a
 * Data API do projeto. A secret key fica no servidor (ignora o RLS, só para
 * o que não tem usuário, como o retorno do worker). A requisição do usuário
 * vai com o JWT dele, e as policies decidem o que ele vê.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "../config.ts";
import { conflict, forbidden, HttpError } from "../lib/errors.ts";

export type Sb = SupabaseClient;

export function adminClient(cfg: Config): Sb {
  return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function userClient(cfg: Config, accessToken: string): Sb {
  return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Estoura o erro do Supabase no formato que a tela já mostra. */
export function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (!res.error) return res.data;
  const msg = res.error.message;
  if (/row-level security|permission denied/i.test(msg)) {
    throw forbidden("Sem acesso a este registro.");
  }
  if (/peça mudou/i.test(msg)) {
    throw conflict("A peça mudou enquanto o ato era registrado. Atualize e tente de novo.");
  }
  console.error("[supabase]", msg);
  throw new HttpError(500, "interno", "Erro interno. Tente de novo.");
}
