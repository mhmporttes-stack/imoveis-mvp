// Rede de segurança do contato humano (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-19): mensagem de SAÍDA do WhatsApp do
// corretor (enviada pelo celular/WhatsApp Web dele) que chegou à sessão do CRM mas NÃO pôde ser decifrada (Baileys:
// messageStubType CIPHERTEXT, fromMe, sem conteúdo) é prova de envio e conta como contato humano — inclusive para o
// prazo da fila de reativação (FUN-15l) e o da roleta. Entra no Chat como uma linha de saída do corretor com texto fixo
// (sem o conteúdo, que o CRM não tem) pelo caminho de sempre (recordBrokerAppMessage -> registerHumanContact, fonte
// única). Se a mesma mensagem chegar depois decifrada (mesmo wa_message_id), a linha é completada com o conteúdo real.
// Mensagem do CONTATO que não decifra continua fora (não é prova de nada nosso). Regras puras; testes em
// tests/whatsapp-undecrypted.test.mjs.

export const UNDECRYPTED_WEBHOOK_TYPE = "undecrypted_message";
export const UNDECRYPTED_OWN_MESSAGE_TEXT = "Mensagem enviada pelo celular — o CRM não conseguiu ler o conteúdo.";

// Payload do microsserviço -> evento para projectIndividualInboundMessage, ou { skip: motivo }.
export function undecryptedOwnMessageEvent(payload = {}) {
  if (payload?.fromMe !== true) return { skip: "nao_e_saida" };
  const waMessageId = String(payload?.waMessageId || "").trim();
  if (!waMessageId) return { skip: "sem_id" };
  const from = String(payload?.from || "").trim();
  if (!from) return { skip: "sem_telefone" };
  if (payload?.group === true || /@g\.us$/i.test(String(payload?.remoteJid || ""))) return { skip: "grupo" };
  return {
    event: {
      from,
      fromMe: true,
      text: UNDECRYPTED_OWN_MESSAGE_TEXT,
      waMessageId,
      at: payload?.at || "",
      remoteJid: String(payload?.remoteJid || ""),
      undecrypted: true
    }
  };
}

// A linha já gravada é o marcador de "não decifrada" e agora chegou o conteúdo real?
export function shouldUpgradeUndecryptedRow(existingMetadata, incomingUndecrypted) {
  return Boolean(existingMetadata?.undecrypted === true && !incomingUndecrypted);
}
