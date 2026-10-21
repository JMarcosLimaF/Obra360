/**
 * HTTP da API. As rotas ficam em `routes/`; aqui só entra o que é comum:
 * CORS com cookie, limite de corpo (a foto da vista vem em JSON) e o
 * formato de erro que a tela já sabe mostrar.
 */
import cors from "@fastify/cors";
import Fastify, { type FastifyError } from "fastify";
import type { Ctx } from "./context.ts";
import { NcFlowError } from "./domain/nc-flow.ts";
import { HttpError } from "./lib/errors.ts";
import { registerSession } from "./auth/session.ts";
import { aiRoutes } from "./routes/ai.ts";
import { authRoutes } from "./routes/auth.ts";
import { catalogRoutes } from "./routes/catalog.ts";
import { fileRoutes } from "./routes/files.ts";
import { issueRoutes } from "./routes/issues.ts";
import { projectRoutes } from "./routes/projects.ts";
import { corsOrigins } from "./config.ts";

export async function buildApp(ctx: Ctx) {
  const app = Fastify({
    logger: ctx.cfg.NODE_ENV !== "test",
    bodyLimit: 20 * 1024 * 1024,
  });
  app.decorate("ctx", ctx);

  await app.register(cors, {
    origin: corsOrigins(ctx.cfg),
    credentials: true,
  });
  await registerSession(app);

  app.setErrorHandler((err: FastifyError | HttpError | NcFlowError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    if (err instanceof NcFlowError) {
      return reply.code(422).send({ error: "tramite", message: err.message });
    }
    const status = "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    const message = status >= 500 ? "Erro interno. Tente de novo." : err.message;
    return reply.code(status).send({ error: status >= 500 ? "interno" : "requisicao_invalida", message });
  });

  app.get("/api/health", async () => ({ ok: true }));
  await authRoutes(app);
  await catalogRoutes(app);
  await projectRoutes(app);
  await issueRoutes(app);
  await aiRoutes(app);
  await fileRoutes(app);
  return app;
}
