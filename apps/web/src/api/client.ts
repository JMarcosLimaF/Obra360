/** Cliente HTTP da API Node. O cookie de sessão vai sozinho; a chave de IA não passa por aqui. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: "include" });
  } catch {
    throw new ApiError("A API não está no ar. Suba o servidor em apps/api.", 0);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({} as { message?: string }));
  if (!res.ok) throw new ApiError(body.message || "Falha na API.", res.status);
  return body as T;
}
