import { NextResponse } from "next/server";

// Resposta de erro padrão das rotas do CHAT: erros esperados do domínio
// (WhatsappChatError) devolvem a própria mensagem/status; qualquer outro erro
// vira uma mensagem genérica (o detalhe técnico fica só no log do servidor).
export function chatErrorResponse(error) {
  if (error?.name === "WhatsappChatError") {
    return NextResponse.json({ error: error.message, code: error.code || "" }, { status: error.status || 400 });
  }
  console.error("Erro no CHAT do WhatsApp:", error?.message || error);
  return NextResponse.json({ error: "Não foi possível concluir a operação no CHAT." }, { status: 500 });
}
