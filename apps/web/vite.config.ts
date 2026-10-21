import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 5199 é a porta do README. A 80 exige administrador e só é necessária
    // se a chave do Matterport estiver cadastrada exatamente em localhost:80.
    port: Number(process.env.PORT) || 5199,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3333",
      "/files": "http://127.0.0.1:3333",
    },
  },
});
