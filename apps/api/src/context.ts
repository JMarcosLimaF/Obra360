import type { Ai } from "./ai/claude.ts";
import type { MemberRole } from "./auth/roles.ts";
import type { Config } from "./config.ts";
import type { Sb } from "./db/supabase.ts";
import type { NcRole } from "./domain/types.ts";
import type { PanoQueue } from "./queue/pano.ts";
import type { Storage } from "./storage.ts";

/** O que as rotas precisam do mundo: config, Supabase, arquivos, IA e fila. */
export interface Ctx {
  cfg: Config;
  /** cliente com a secret key — não usar numa rota de usuário */
  admin: Sb;
  storage: Storage;
  ai: Ai;
  /** nula quando não há REDIS_URL — o resto da API funciona sem fila */
  queue: PanoQueue | null;
  today(): string;
}

export interface Membership {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: MemberRole;
  ncRole: NcRole | null;
}

export interface AuthInfo {
  user: { id: string; name: string; email: string };
  memberships: Membership[];
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: Ctx;
  }
  interface FastifyRequest {
    auth: AuthInfo;
    /** JWT do Supabase desta requisição, já conferido */
    accessToken: string;
  }
}
