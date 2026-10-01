const VOICE_MONKEY_ENDPOINT = "https://api-v3.voicemonkey.io/announce";

// Os logs abaixo nunca incluem token, device ID nem o corpo da resposta —
// só o motivo do descarte, o status HTTP e o tipo do erro.
function skip(reason) {
  console.warn(`[alexa-voice] disparo ignorado: ${reason}.`);
  return { skipped: true, reason };
}

// Fala uma frase curta no Echo Dot do escritório via Voice Monkey. Best-effort:
// nunca lança erro nem atrasa o fluxo que chamou (timeout curto). Só funciona
// com ALEXA_VOICE_ENABLED=true e as duas envs do Voice Monkey configuradas.
export async function speakAlexa(speech) {
  if (process.env.ALEXA_VOICE_ENABLED !== "true") return skip("ALEXA_VOICE_ENABLED não é 'true' neste ambiente");

  const token = process.env.VOICEMONKEY_TOKEN || "";
  const device = process.env.VOICEMONKEY_DEVICE || "";
  const text = String(speech || "").replace(/\s+/g, " ").trim().slice(0, 400);
  const missing = [!token && "VOICEMONKEY_TOKEN", !device && "VOICEMONKEY_DEVICE"].filter(Boolean);
  if (missing.length) return skip(`configuração ausente: ${missing.join(", ")}`);
  if (!text) return skip("frase vazia");

  try {
    const response = await fetch(VOICE_MONKEY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        device,
        speech: text,
        language: process.env.VOICEMONKEY_LANGUAGE || "pt-BR",
        ...(process.env.VOICEMONKEY_VOICE ? { voice: process.env.VOICEMONKEY_VOICE } : {})
      }),
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) {
      console.warn(`[alexa-voice] Voice Monkey recusou o envio (HTTP ${response.status}).`);
      return { skipped: false, ok: false, status: response.status };
    }
    console.info(`[alexa-voice] enviado com sucesso (HTTP ${response.status}).`);
    return { skipped: false, ok: true };
  } catch (error) {
    console.warn(`[alexa-voice] falha ao chamar o Voice Monkey: ${error?.name || "erro"}.`);
    return { skipped: false, ok: false };
  }
}
