import { NextResponse } from "next/server";
import { isAdminPermissionError } from "@/lib/admin-access";

// Padrão `{ error: "..." }` + status HTTP. Erro conhecido (SupportTicketError, permissão) mostra a própria mensagem;
// qualquer outro vira a mensagem genérica e vai para o log do servidor.
export function supportErrorResponse(error, fallback = "Não foi possível concluir agora.") {
  const permission = isAdminPermissionError(error);
  const known = permission || error?.name === "SupportTicketError";
  if (!known) console.error("[support]", error?.message || error);
  return NextResponse.json({ error: known ? error.message : fallback }, { status: known ? error?.status || 403 : 500 });
}
