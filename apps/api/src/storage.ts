/**
 * Armazenamento de arquivos (fotos, plantas, panoramas).
 *
 * As imagens não vão para o banco nem voltam embutidas no JSON: entram aqui uma
 * vez, com chave derivada do hash do conteúdo, e o cliente recebe uma URL da API.
 * Mesma foto anexada duas vezes (a da visita reaproveitada como evidência) é o
 * mesmo arquivo — e chave por hash é imutável, então pode ter cache infinito.
 *
 * Em desenvolvimento é um diretório (STORAGE_ROOT), o mesmo que o worker Python
 * lê e escreve. Em produção troca-se por S3/Supabase Storage atrás desta classe.
 * Toda chave começa por `org/<id>/`: é o que permite servir o arquivo só a quem
 * é da organização.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { badRequest } from "./lib/errors.ts";

export type ImageMedia = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const EXT: Record<ImageMedia, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/** Teto por imagem — screenshot do tour reduzido fica em ~200 KB; prancha, poucos MB. */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Normaliza o data URL de imagem para o que a API de visão aceita.
 * O Renderer do Matterport devolve `data:image/jpg;base64,...` — `image/jpg` não é
 * media type válido (o certo é `image/jpeg`), então traduzimos na entrada.
 */
export function parseDataUrl(dataUrl: string): { mediaType: ImageMedia; data: Buffer } | null {
  const m = String(dataUrl ?? "").match(/^data:image[/]([a-z0-9.+-]+);base64,([^]+)$/i);
  if (!m) return null;
  const sub = m[1].toLowerCase();
  const mediaType: ImageMedia | null =
    sub === "jpg" || sub === "jpeg" ? "image/jpeg"
    : sub === "png" ? "image/png"
    : sub === "webp" ? "image/webp"
    : sub === "gif" ? "image/gif"
    : null;
  if (!mediaType) return null;
  return { mediaType, data: Buffer.from(m[2].trim(), "base64") };
}

export function mediaTypeOfKey(key: string): string {
  return CONTENT_TYPE[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export class Storage {
  constructor(
    readonly root: string,
    private readonly publicUrl: string,
  ) {}

  /** Caminho no disco, sem deixar a chave escapar do diretório raiz. */
  private file(key: string): string {
    if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
      throw badRequest("Chave de arquivo inválida.");
    }
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw badRequest("Chave de arquivo inválida.");
    return full;
  }

  async put(key: string, data: Buffer): Promise<string> {
    const full = this.file(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return key;
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.file(key)).then((s) => s.isFile(), () => false);
  }

  read(key: string) {
    return createReadStream(this.file(key));
  }

  async readBuffer(key: string): Promise<Buffer> {
    const { readFile } = await import("node:fs/promises");
    return readFile(this.file(key));
  }

  /** URL pública (autenticada por cookie) de uma chave. */
  url(key: string): string {
    return `${this.publicUrl}/files/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  /** Se `ref` é URL de arquivo desta API, devolve a chave; senão null. */
  keyFromUrl(ref: string): string | null {
    let pathname: string;
    try {
      const u = new URL(ref, this.publicUrl);
      if (u.origin !== new URL(this.publicUrl).origin) return null;
      pathname = u.pathname;
    } catch {
      return null;
    }
    if (!pathname.startsWith("/files/")) return null;
    return pathname.slice("/files/".length).split("/").map(decodeURIComponent).join("/");
  }

  /**
   * Recebe a imagem como chega do cliente — data URL nova ou URL de arquivo que
   * esta API já guardou — e devolve a chave. Nunca busca URL de terceiros: o
   * servidor não sai baixando o que o cliente mandar (SSRF).
   */
  async keyFromRef(orgId: string, ref: string): Promise<string> {
    const parsed = parseDataUrl(ref);
    if (parsed) {
      if (parsed.data.length === 0) throw badRequest("Imagem vazia.");
      if (parsed.data.length > MAX_IMAGE_BYTES) throw badRequest("Imagem maior que 15 MB.");
      const hash = createHash("sha256").update(parsed.data).digest("hex");
      const key = `org/${orgId}/img/${hash}.${EXT[parsed.mediaType]}`;
      if (!(await this.exists(key))) await this.put(key, parsed.data);
      return key;
    }
    const key = this.keyFromUrl(ref);
    if (key) {
      if (!key.startsWith(`org/${orgId}/`)) throw badRequest("A imagem pertence a outra organização.");
      if (!(await this.exists(key))) throw badRequest("Imagem não encontrada no acervo.");
      return key;
    }
    throw badRequest("Imagem em formato não reconhecido: envie JPG, PNG, WebP ou GIF.");
  }

  /** Bytes + media type de uma referência, para enviar à IA. */
  async load(orgId: string, ref: string): Promise<{ mediaType: ImageMedia; data: Buffer }> {
    const parsed = parseDataUrl(ref);
    if (parsed) return parsed;
    const key = await this.keyFromRef(orgId, ref);
    const mediaType = mediaTypeOfKey(key);
    if (!(mediaType in EXT)) throw badRequest("Formato de imagem não aceito pela IA.");
    return { mediaType: mediaType as ImageMedia, data: await this.readBuffer(key) };
  }
}
