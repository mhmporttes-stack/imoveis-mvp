export class HttpError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, "invalid_request", details);
export const notFound = (msg = "Não encontrado.") => new HttpError(404, msg, "not_found");
export const conflict = (msg, code = "conflict") => new HttpError(409, msg, code);

// Classificação padronizada de falha do provedor (usada por todos os adaptadores).
//  temporary: pode tentar de novo com backoff (nada saiu).
//  permanent: não tentar de novo.
//  unknown:   pedido pode ter chegado ao provedor; NÃO reenviar sem verificação.
export class ProviderError extends Error {
  constructor(message, { kind, code = null, httpStatus = null, instanceImpact = null, retryAfterMs = null } = {}) {
    super(message);
    this.kind = kind;
    this.code = code == null ? null : String(code);
    this.httpStatus = httpStatus;
    // null | 'auth' | 'restricted' | 'quality' | 'disconnected' | 'rate_limited' | 'template' | 'not_configured'
    this.instanceImpact = instanceImpact;
    this.retryAfterMs = retryAfterMs;
  }
}

export class UnsupportedOperationError extends Error {
  constructor(provider, operation) {
    super(`Operação '${operation}' não é suportada pelo provedor '${provider}'.`);
    this.code = "unsupported_operation";
    this.operation = operation;
  }
}
