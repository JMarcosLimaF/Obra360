/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** applicationKey do Matterport SDK for Embeds. */
  readonly VITE_MP_SDK_KEY?: string;
  /** Endereço da API no site público. Vazio no localhost. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
