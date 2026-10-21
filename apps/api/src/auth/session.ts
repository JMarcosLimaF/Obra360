/**
 * Sessão do Supabase Auth, guardada em cookie httpOnly.
 *
 * O login troca e-mail e senha no GoTrue. O access token (JWT do Supabase) e o
 * refresh token não ficam acessíveis ao JavaScript da página. Cada requisição
 * confere a assinatura no JWKS do projeto; se o access token venceu, troca pelo
 * refresh antes de seguir. Usuário e papel vêm do token e de org_members —
 * desativar o vínculo vale na hora.
 */
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, errors, type JWTPayload } from "jose";
import type { AuthInfo, Membership } from "../context.ts";
import { ok } from "../db/supabase.ts";
import { HttpError } from "../lib/errors.ts";
import { ncRoleOf, type MemberRole } from "./roles.ts";

const ACCESS_COOKIE = "obra360_session";
const REFRESH_COOKIE = "obra360_refresh";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function jwksFor(app: FastifyInstance) {
  if (!jwks) jwks = createRemoteJWKSet(new URL(app.ctx.cfg.SUPABASE_JWKS_URL));
  return jwks;
}

export async function registerSession(app: FastifyInstance): Promise<void> {
  await app.register(cookie);
}

function cookieBase(app: FastifyInstance) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: app.ctx.cfg.COOKIE_SECURE,
    path: "/",
  };
}

export function setSessionCookies(
  app: FastifyInstance,
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): void {
  reply.setCookie(ACCESS_COOKIE, accessToken, { ...cookieBase(app), maxAge: expiresIn });
  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    ...cookieBase(app),
    maxAge: app.ctx.cfg.SESSION_HOURS * 3600,
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { path: "/" });
  reply.clearCookie(REFRESH_COOKIE, { path: "/" });
}

interface GoTrueSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Troca e-mail e senha por uma sessão do GoTrue. */
export async function signInWithPassword(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<GoTrueSession> {
  return gotrueToken(app, { grant_type: "password", email, password });
}

async function refreshSession(app: FastifyInstance, refreshToken: string): Promise<GoTrueSession> {
  return gotrueToken(app, { grant_type: "refresh_token", refresh_token: refreshToken });
}

async function gotrueToken(app: FastifyInstance, body: Record<string, string>): Promise<GoTrueSession> {
  const { cfg } = app.ctx;
  const grant = body.grant_type === "refresh_token" ? "refresh_token" : "password";
  const res = await fetch(`${cfg.SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: {
      apikey: cfg.SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new HttpError(401, "credenciais", "E-mail ou senha não conferem.");
  }
  const data = (await res.json()) as Partial<GoTrueSession>;
  if (!data.access_token || !data.refresh_token || !data.expires_in) {
    throw new HttpError(401, "credenciais", "O Supabase não devolveu uma sessão.");
  }
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in };
}

function profileOf(payload: JWTPayload): { id: string; name: string; email: string } {
  const meta = (payload.user_metadata ?? {}) as { name?: string; full_name?: string };
  const email = typeof payload.email === "string" ? payload.email : "";
  const id = typeof payload.sub === "string" ? payload.sub : "";
  return { id, email, name: meta.name || meta.full_name || email };
}

async function verifyAccess(app: FastifyInstance, token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, jwksFor(app), {
    issuer: `${app.ctx.cfg.SUPABASE_URL}/auth/v1`,
    audience: "authenticated",
  });
  return payload;
}

/** Usuário do token + vínculos. A secret key lê isto porque é o que define o papel, antes do RLS. */
export async function loadAuth(
  app: FastifyInstance,
  user: { id: string; name: string; email: string },
): Promise<AuthInfo | null> {
  if (!user.id) return null;
  const rows = ok(
    await app.ctx.admin
      .from("org_members")
      .select("org_id, role, organizations(name, slug)")
      .eq("user_id", user.id),
  ) as unknown as { org_id: string; role: MemberRole; organizations: { name: string; slug: string } | { name: string; slug: string }[] | null }[];
  const memberships: Membership[] = rows.flatMap((r) => {
    const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
    if (!org) return [];
    return [{
      orgId: r.org_id,
      orgName: org.name,
      orgSlug: org.slug,
      role: r.role,
      ncRole: ncRoleOf(r.role),
    }];
  }).sort((a, b) => a.orgName.localeCompare(b.orgName, "pt"));
  if (!memberships.length) return null;
  return { user, memberships };
}

/** preHandler das rotas protegidas. */
export function authenticate(app: FastifyInstance) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    let payload: JWTPayload | undefined;
    let token = req.cookies[ACCESS_COOKIE];
    const access = token;
    const refresh = req.cookies[REFRESH_COOKIE];
    if (access) {
      try {
        payload = await verifyAccess(app, access);
      } catch (err) {
        if (!(err instanceof errors.JWTExpired) || !refresh) {
          throw new HttpError(401, "sessao_invalida", "Sessão expirada ou ausente. Entre novamente.");
        }
      }
    }
    if (!payload && refresh) {
      try {
        const next = await refreshSession(app, refresh);
        token = next.access_token;
        setSessionCookies(app, reply, next.access_token, next.refresh_token, next.expires_in);
        payload = await verifyAccess(app, next.access_token);
      } catch {
        throw new HttpError(401, "sessao_invalida", "Sessão expirada ou ausente. Entre novamente.");
      }
    }
    const auth = payload && token ? await loadAuth(app, profileOf(payload)) : null;
    if (!auth || !token) throw new HttpError(401, "sessao_invalida", "Usuário inativo ou removido.");
    req.accessToken = token;
    req.auth = auth;
  };
}
