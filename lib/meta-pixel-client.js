"use client";

import { META_PIXEL_ID, normalizePhoneForMeta } from "./meta-pixel-shared";

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Dispara o evento "Lead" pro pixel no navegador, com Advanced Matching
// manual (telefone hasheado — nunca em texto puro) e o mesmo eventId usado
// no envio server-side (Conversions API, lib/meta-conversions-api.js) para a
// Meta deduplicar o mesmo evento vindo dos dois canais, como a própria Meta
// recomenda. Best-effort: nunca deve interromper o fluxo de cadastro do
// visitante (pixel bloqueado/ausente, sem token, etc.).
export async function trackMetaLead({ phone, eventId, incomeBracket = "" } = {}) {
  if (!META_PIXEL_ID || typeof window === "undefined" || typeof window.fbq !== "function") return;

  try {
    const digitsPhone = normalizePhoneForMeta(phone);
    if (digitsPhone) {
      const hashedPhone = await sha256Hex(digitsPhone);
      window.fbq("init", META_PIXEL_ID, { ph: hashedPhone });
    }

    const customData = incomeBracket ? { content_category: incomeBracket } : {};
    window.fbq("track", "Lead", customData, eventId ? { eventID: eventId } : undefined);
  } catch {
    // silencioso — rastreamento nunca pode quebrar o cadastro do visitante.
  }
}
