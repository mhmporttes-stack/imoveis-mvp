// Limite de tempo por chamada ao Supabase: sem ele, uma conexão reaproveitada que morreu
// deixava a função pendurada até a Vercel matá-la (lote-sms 60 s, crons 20-300 s).
// Leituras (GET/HEAD) tentam de novo uma vez; escritas nunca são repetidas.
const SUPABASE_FETCH_TIMEOUT_MS = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS) || 15000;

export async function fetchWithTimeout(input, init = {}, fetchImpl = globalThis.fetch) {
  const method = String(init.method || (input && input.method) || "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD";
  const attempts = canRetry ? 2 : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS);
    const signal = init.signal && AbortSignal.any ? AbortSignal.any([init.signal, timeoutSignal]) : init.signal || timeoutSignal;
    try {
      return await fetchImpl(input, { ...init, signal });
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) throw error;
    }
  }
  throw lastError;
}
