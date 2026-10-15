// Links do site público usados em mais de um lugar (abertura, barra do celular, botão flutuante).
// Módulo comum (sem "use client") para poder ser lido também por Server Components.
import { whatsappMessageLink } from "../../lib/format.js";

// WhatsApp OFICIAL (lib/official-whatsapp.mjs, via whatsappMessageLink) — o número novo, ativo e no CRM.
export const siteWhatsappUrl =
  whatsappMessageLink("Olá, Matheus! Encontrei seu contato pelo site e gostaria de mais informações sobre os imóveis.");
