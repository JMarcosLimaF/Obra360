/**
 * Persistência local enquanto não existe backend.
 *
 * O acervo do usuário (pendências, análises, RDOs) não pode sumir ao recarregar
 * a página — é o mínimo para o diário de obra ter valor. Guardamos em
 * localStorage com dois cuidados: as imagens das análises entram reduzidas
 * (ver `lib/image.ts`) e a gravação degrada em vez de quebrar quando a cota
 * do navegador se esgota.
 */

const PREFIX = "obra360.";

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export type SaveResult = "ok" | "quota" | "unavailable";

export function save(key: string, value: unknown): SaveResult {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return "ok";
  } catch (err) {
    const quota =
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED");
    return quota ? "quota" : "unavailable";
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* modo privado */
  }
}

/** Conteúdo exportável para backup manual (.json). */
export function snapshot(keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { _app: "obra360", _version: 1 };
  for (const k of keys) out[k] = load(k, null);
  return out;
}
