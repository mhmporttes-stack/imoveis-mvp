// Rastro de quem estava de fato no teclado ao enviar pelo Chat (2026-10-08). O remetente de uma mensagem é sempre a
// CONTA logada; quando a conta é emprestada ou usada em "Alterar conta", o administrador precisa conseguir ver de onde
// saiu o envio. Puro e testado (tests/chat-actor-context.test.mjs). Só o administrador recebe esta descrição.

function deviceLabel(ua = "") {
  const text = String(ua || "");
  if (!text) return "";
  const system = /iPhone|iPad|iPod/i.test(text) ? "iPhone/iPad" : /Android/i.test(text) ? "Android" : /Windows/i.test(text) ? "Windows" : /Macintosh|Mac OS/i.test(text) ? "Mac" : /Linux/i.test(text) ? "Linux" : "";
  const browser = /Edg\//i.test(text) ? "Edge" : /OPR\/|Opera/i.test(text) ? "Opera" : /Firefox\//i.test(text) ? "Firefox" : /Chrome\/|CriOS/i.test(text) ? "Chrome" : /Safari\//i.test(text) ? "Safari" : "";
  return [system, browser].filter(Boolean).join(" · ");
}

/** Texto curto para o administrador: "Alterar conta (Matheus Machado)" ou "Windows · Chrome · IP 191.x · sessão ab12cd". */
export function describeChatActor(ctx) {
  if (!ctx || typeof ctx !== "object") return "";
  const parts = [];
  if (ctx.via) parts.push(`via Alterar conta${ctx.realName ? ` (${String(ctx.realName).slice(0, 60)})` : ""}`);
  const device = deviceLabel(ctx.ua);
  if (device) parts.push(device);
  if (ctx.ip) parts.push(`IP ${String(ctx.ip).slice(0, 45)}`);
  if (ctx.s) parts.push(`sessão ${String(ctx.s).slice(-6)}`);
  return parts.join(" · ");
}
