import { NextResponse } from "next/server";
import { isAdminPermissionError } from "@/lib/admin-access";

// Resposta de erro padrão das rotas de mensagens de supervisão: erros
// esperados (SupervisionMessageError / permissão) devolvem a própria
// mensagem; qualquer outro vira mensagem genérica (detalhe só no log).
export function supervisionErrorResponse(error) {
  if (error?.name === "SupervisionMessageError") {
    return NextResponse.json({ error: error.message }, { status: error.status || 400 });
  }
  if (isAdminPermissionError(error)) {
    return NextResponse.json({ error: error.message || "Acesso não autorizado." }, { status: 403 });
  }
  console.error("Erro nas mensagens de supervisão:", error?.message || error);
  return NextResponse.json({ error: "Não foi possível concluir a operação." }, { status: 500 });
}
