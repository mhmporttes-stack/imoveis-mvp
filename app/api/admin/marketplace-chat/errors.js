import { NextResponse } from "next/server";
import { isAdminPermissionError } from "@/lib/admin-access";

// Erro legível (MarketplaceChatError/permissão) com o status dele; o resto vira 500 genérico.
export function marketplaceChatErrorResponse(error, fallback = "Não foi possível concluir a ação.") {
  const status = error?.status || (isAdminPermissionError(error) ? 403 : 500);
  if (status === 500) console.error("[marketplace-chat]", error?.message || error);
  return NextResponse.json({ error: status === 500 ? fallback : error.message }, { status });
}
