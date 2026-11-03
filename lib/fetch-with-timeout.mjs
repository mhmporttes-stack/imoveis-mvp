// Limite de tempo por chamada ao Supabase: sem ele, uma conexão reaproveitada que morreu
// deixava a função pendurada até a Vercel matá-la (lote-sms 60 s, crons 20-300 s).
// Leituras (GET/HEAD) tentam de novo uma vez; escritas nunca são repetidas.
const SUPABASE_FETCH_TIMEOUT_MS = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS) || 15000;

const SLOW_LOG_MS = 3000;

// Só o caminho (tabela/rpc), sem parâmetros nem valores: nunca grava dado de cliente nem chave nos logs.
function safeLabel(input) {
  try {
    const raw = typeof input === "string" ? input : input?.url || String(input);
    return new URL(raw).pathname.replace(/^\/(rest|auth|storage)\/v1\//, "$1/").slice(0, 80);
  } catch {
    return "?";
  }
}

export async function fetchWithTimeout(input, init = {}, fetchImpl = globalThis.fetch) {
  const method = String(init.method || (input && input.method) || "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD";
  const attempts = canRetry ? 2 : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS);
    const signal = init.signal && AbortSignal.any ? AbortSignal.any([init.signal, timeoutSignal]) : init.signal || timeoutSignal;
    const startedAt = Date.now();
    try {
      const response = await fetchImpl(input, { ...init, signal });
      const elapsed = Date.now() - startedAt;
      if (elapsed >= SLOW_LOG_MS) console.warn(`[supabase-lento] ${method} ${safeLabel(input)} ${elapsed} ms (tentativa ${attempt})`);
      return response;
    } catch (error) {
      lastError = error;
      console.warn(`[supabase-falha] ${method} ${safeLabel(input)} ${Date.now() - startedAt} ms (tentativa ${attempt}): ${error?.name || "erro"}`);
      if (init.signal?.aborted) throw error;
    }
  }
  throw lastError;
}
