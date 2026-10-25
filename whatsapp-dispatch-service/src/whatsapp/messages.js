import { ProviderError } from "../utils/errors.js";

// Cloud API — envio. POST /{phone-number-id}/messages
// https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
// https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
// A resposta 200 só significa "pedido aceito" (messages[0].id = wamid); entrega/leitura chegam pelo webhook.
// biz_opaque_callback_data volta no webhook de status — usado para resolver um envio de resultado desconhecido.
// https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status

export function buildCloudMessageBody({ to, campaign, callbackData }) {
  const body = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (campaign.message_type === "template") {
    body.type = "template";
    body.template = { name: campaign.template_name, language: { code: campaign.template_language } };
    if (Array.isArray(campaign.template_components) && campaign.template_components.length) {
      body.template.components = campaign.template_components;
    }
  } else {
    // Texto livre: a Meta só entrega dentro da janela de atendimento de 24 h (erro 131047 fora dela).
    body.type = "text";
    body.text = { body: campaign.text_body, preview_url: false };
  }
  if (callbackData) body.biz_opaque_callback_data = String(callbackData).slice(0, 512);
  return body;
}

export async function sendCloudMessage(graph, token, instance, payload) {
  const data = await graph.request("POST", `/${instance.provider_config.phone_number_id}/messages`, {
    token, json: buildCloudMessageBody(payload), sendOperation: true
  });
  const message = Array.isArray(data?.messages) ? data.messages[0] : null;
  if (!message?.id) {
    // 200 sem id: não dá para afirmar que saiu nem que não saiu.
    throw new ProviderError("Graph API respondeu sem o id da mensagem.", { kind: "unknown" });
  }
  return { providerMessageId: message.id, pacingStatus: message.message_status || null };
}
