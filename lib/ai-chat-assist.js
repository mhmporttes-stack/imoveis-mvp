import "server-only";
import { recordAiUsage } from "./ai-usage";

// IA de apoio ao Chat (pedido do dono, 2026-10-10), sempre SOB DEMANDA (botão) e registrada em ai_usage_log:
// - summarizeConversation: resumo de 3 linhas pela Anthropic (mesma chave/modelo da análise de documentos, fetch direto).
// - transcribeAudio: áudio -> texto pela OpenAI (OPENAI_API_KEY; sem chave a função nem é chamada).

const ANTHROPIC_VERSION = "2023-06-01";
const SUMMARY_MODEL = process.env.ANTHROPIC_CHAT_SUMMARY_MODEL || process.env.ANTHROPIC_DOCUMENT_MODEL || "claude-sonnet-5";
// Estimativa de custo (US$/milhão de tokens) — a mesma tabela do modelo padrão da análise de documentos.
const SUMMARY_PRICE_INPUT = 2;
const SUMMARY_PRICE_OUTPUT = 10;
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
// Estimativa: US$ 0,003 por minuto; sem duração exata, conta pelo tamanho (~16 kB/s em opus de voz).
const TRANSCRIBE_USD_PER_MINUTE = 0.003;

const SUMMARY_INSTRUCTIONS = `Você resume conversas de WhatsApp de uma imobiliária (Minha Casa Minha Vida, primeiro imóvel, Marília/SP) para o corretor que vai assumir o atendimento.
Responda SOMENTE com 3 linhas, sem markdown, sem inventar nada que não esteja na conversa:
Quer: <o que o cliente busca, em poucas palavras>
Perfil: <renda, tipo de renda, FGTS, entrada, estado civil, cidade — só o que foi dito; "não informado" se nada>
Próximo passo: <a ação mais útil agora para o corretor>`;

export async function summarizeConversation({ lines, contactName = "", triggeredBy = null, clientId = null }) {
  const token = process.env.ANTHROPIC_API_KEY;
  if (!token) throw Object.assign(new Error("Resumo por IA não configurado."), { status: 503 });
  let usage = null;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": token, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        max_tokens: 300,
        system: SUMMARY_INSTRUCTIONS,
        messages: [{ role: "user", content: `Contato: ${contactName || "sem nome"}\n\nConversa (mais antiga primeiro):\n${lines.join("\n")}` }]
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `Falha na IA (HTTP ${response.status}).`);
    usage = data.usage || {};
    const text = (data.content || []).filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
    if (!text) throw new Error("A IA não devolveu resumo.");
    await recordAiUsage({
      feature: "chat_summary", model: SUMMARY_MODEL, clientId, triggeredBy,
      inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
      costUsd: (Number(usage.input_tokens) || 0) / 1e6 * SUMMARY_PRICE_INPUT + (Number(usage.output_tokens) || 0) / 1e6 * SUMMARY_PRICE_OUTPUT
    });
    return text.slice(0, 1200);
  } catch (error) {
    await recordAiUsage({ feature: "chat_summary", model: SUMMARY_MODEL, clientId, triggeredBy, success: false, errorMessage: error?.message });
    throw error;
  }
}

export async function transcribeAudio({ buffer, contentType = "audio/ogg", triggeredBy = null, clientId = null }) {
  const token = process.env.OPENAI_API_KEY;
  if (!token) throw Object.assign(new Error("Transcrição de áudio não configurada."), { status: 503 });
  const extension = /mpeg|mp3/.test(contentType) ? "mp3" : /mp4|m4a|aac/.test(contentType) ? "m4a" : /webm/.test(contentType) ? "webm" : "ogg";
  try {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: contentType.split(";")[0] || "audio/ogg" }), `audio.${extension}`);
    form.append("model", TRANSCRIBE_MODEL);
    form.append("language", "pt");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `Falha na transcrição (HTTP ${response.status}).`);
    const text = String(data.text || "").trim();
    await recordAiUsage({ feature: "chat_audio_transcription", model: TRANSCRIBE_MODEL, clientId, triggeredBy, costUsd: (buffer.length / 16000 / 60) * TRANSCRIBE_USD_PER_MINUTE });
    return text || "(áudio sem fala reconhecida)";
  } catch (error) {
    await recordAiUsage({ feature: "chat_audio_transcription", model: TRANSCRIBE_MODEL, clientId, triggeredBy, success: false, errorMessage: error?.message });
    throw error;
  }
}
