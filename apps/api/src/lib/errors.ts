/** Erro com status HTTP e mensagem que a tela pode mostrar como está. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, "nao_encontrado", `${what} não encontrado(a).`);
export const forbidden = (message = "Seu papel não permite esta operação.") =>
  new HttpError(403, "sem_permissao", message);
export const badRequest = (message: string) => new HttpError(400, "requisicao_invalida", message);
export const conflict = (message: string) => new HttpError(409, "conflito", message);
