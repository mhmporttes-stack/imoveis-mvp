const VOICE_MONKEY_ENDPOINT = "https://api-v3.voicemonkey.io/announce";

// Fala uma frase curta no Echo Dot do escritório via Voice Monkey. Best-effort:
// nunca lança erro nem atrasa o fluxo que chamou (timeout curto). Só funciona
// com ALEXA_VOICE_ENABLED=true e as duas envs do Voice Monkey configuradas.
export async function speakAlexa(speech) {
  if (process.env.ALEXA_VOICE_ENABLED !== "true") return { skipped: true, reason: "ALEXA_VOICE_ENABLED desligado" };

  const token = process.env.VOICEMONKEY_TOKEN || "";
  const device = process.env.VOICEMONKEY_DEVICE || "";
  const text = String(speech || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!token || !device) return { skipped: true, reason: "Configuração ausente: VOICEMONKEY_TOKEN/VOICEMONKEY_DEVICE" };
  if (!text) return { skipped: true, reason: "Frase vazia" };

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
      console.warn("Alexa voice failed:", response.status);
      return { skipped: false, ok: false, status: response.status };
    }
    return { skipped: false, ok: true };
  } catch (error) {
    console.warn("Alexa voice failed:", error?.message || error);
    return { skipped: false, ok: false };
  }
}
