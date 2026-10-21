import { Ai } from "./ai/claude.ts";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { adminClient } from "./db/supabase.ts";
import { businessToday } from "./lib/today.ts";
import { createPanoQueue } from "./queue/pano.ts";
import { Storage } from "./storage.ts";

const cfg = loadConfig();
const admin = adminClient(cfg);

const storage = new Storage(cfg.STORAGE_ROOT, cfg.PUBLIC_URL);
const ai = new Ai(cfg);
const queue = cfg.REDIS_URL
  ? createPanoQueue(cfg.REDIS_URL, admin, {
      info: (m) => console.log(m),
      warn: (m) => console.warn(m),
    })
  : null;

const app = await buildApp({
  cfg,
  admin,
  storage,
  ai,
  queue,
  today: () => businessToday(cfg),
});

const close = async () => {
  await app.close();
  await queue?.close();
  process.exit(0);
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await app.listen({ host: cfg.HOST, port: cfg.PORT });
console.log(`[api] http://${cfg.HOST}:${cfg.PORT}  (IA ${ai.configured ? "configurada" : "simulada"})`);
