// Para onde o botão "WhatsApp" do card do cliente leva (usado no card de
// Clientes). Sempre abre o Chat do CRM: o próprio Chat decide, por
// mensagem, se envia pela sessão individual do corretor (WhatsApp Web,
// sem limite de 24h) ou pelo número oficial — nunca mais escapa para o
// WhatsApp pessoal do corretor fora do CRM (perderia histórico/registro).
// Só decide o destino; registrar o contato continua sendo feito pelo chamador.
export async function resolveClientWhatsappDestination(clientId) {
  return { channel: "chat", url: `/admin/chat?client=${encodeURIComponent(clientId)}` };
}
