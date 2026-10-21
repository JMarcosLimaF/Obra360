/** Serve o arquivo só para quem é da organização dona da chave `org/<id>/…`. */
import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/session.ts";
import { forbidden, notFound } from "../lib/errors.ts";
import { mediaTypeOfKey } from "../storage.ts";

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/files/*", { preHandler: authenticate(app) }, async (req, reply) => {
    const raw = (req.params as { "*": string })["*"] ?? "";
    const key = raw.split("/").map(decodeURIComponent).join("/");
    const orgId = key.startsWith("org/") ? key.split("/")[1] : "";
    if (!orgId || !req.auth.memberships.some((m) => m.orgId === orgId)) throw forbidden("Arquivo de outra organização.");
    if (!(await app.ctx.storage.exists(key))) throw notFound("Arquivo");
    return reply.type(mediaTypeOfKey(key)).send(app.ctx.storage.read(key));
  });
}
