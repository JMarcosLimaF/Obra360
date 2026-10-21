import type { FastifyInstance } from "fastify";
import {
  authenticate,
  clearSessionCookies,
  loadAuth,
  setSessionCookies,
  signInWithPassword,
} from "../auth/session.ts";
import { HttpError } from "../lib/errors.ts";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (req, reply) => {
    const body = req.body as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";
    if (!email || !password) throw new HttpError(400, "requisicao_invalida", "Informe e-mail e senha.");

    const session = await signInWithPassword(app, email, password);
    const payload = decodePayload(session.access_token);
    const auth = await loadAuth(app, payload);
    if (!auth) throw new HttpError(403, "sem_acesso", "Esta conta não participa de nenhuma organização.");
    setSessionCookies(app, reply, session.access_token, session.refresh_token, session.expires_in);
    return sessionBody(app, auth);
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    clearSessionCookies(app, reply);
    return reply.code(204).send();
  });

  app.get("/api/auth/me", { preHandler: authenticate(app) }, async (req) => sessionBody(app, req.auth));
}

/** O access token já foi emitido pelo GoTrue; aqui só lemos o perfil, sem confiar na assinatura de novo. */
function decodePayload(accessToken: string): { id: string; name: string; email: string } {
  const part = accessToken.split(".")[1] ?? "";
  const json = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
    sub?: string;
    email?: string;
    user_metadata?: { name?: string; full_name?: string };
  };
  const email = json.email ?? "";
  return {
    id: json.sub ?? "",
    email,
    name: json.user_metadata?.name || json.user_metadata?.full_name || email,
  };
}

function sessionBody(
  app: FastifyInstance,
  auth: { user: { id: string; name: string; email: string }; memberships: unknown[] },
) {
  return {
    user: auth.user,
    memberships: auth.memberships,
    today: app.ctx.today(),
    aiConfigured: app.ctx.ai.configured,
  };
}
