/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Chave da API Anthropic do ambiente de demonstração (ver .env.local). */
  readonly VITE_ANTHROPIC_KEY?: string;
  /** applicationKey do Matterport SDK for Embeds. */
  readonly VITE_MP_SDK_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
