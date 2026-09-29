import "server-only";
import { getSupabaseAdminClient } from "./supabase";

// Limite de tentativas por chave (IP+telefone, IP+arquivo etc.) PERSISTIDO no
// banco — nunca um Map em memória do processo: em serverless (Vercel), cada
// invocação pode cair numa instância fria diferente, então um Map local
// nunca "lembra" da tentativa anterior do mesmo atacante na prática (bug
// real, P-09 do pente-fino 2026-09-24, corrigido 2026-09-29). A trava de
// verdade é a função check_public_rate_limit (migration
// 20260929120000_public_form_rate_limits.sql) — UPSERT atômico, sem race
// condition de leitura-depois-escrita.
//
// Best-effort: se o Supabase não responder, libera — falhar fechado aqui
// derrubaria um formulário público real (cadastro, captação) por uma falha
// de infra, o que é pior que deixar passar uma rajada de spam ocasional.
export async function checkPublicRateLimit(key, { windowSeconds, maxAttempts }) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return true;

  try {
    const { data, error } = await supabase.rpc("check_public_rate_limit", {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_max_attempts: maxAttempts
    });
    if (error) throw error;
    return data !== false;
  } catch (error) {
    console.warn("Falha ao checar limite de tentativas do formulário público:", error?.message || error);
    return true;
  }
}

// Chave padrão: IP + um identificador do que está sendo enviado (telefone,
// e-mail...) — nunca só o IP (vários clientes reais atrás do mesmo NAT/rede
// corporativa não podem travar uns aos outros) nem só o identificador
// (impede um atacante de rodar o mesmo telefone de IPs diferentes, mas ainda
// segura o caso comum de clique repetido/bot simples).
export function buildRateLimitKey(request, discriminator) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return `${ip}:${String(discriminator || "").trim().toLowerCase()}`;
}
