import { NextResponse } from "next/server";
import { isAdminPermissionError } from "@/lib/admin-access";

export function cooledErrorResponse(error) {
  const status = error?.name === "CooledClientError" ? error.status : isAdminPermissionError(error) ? 403 : 500;
  if (status >= 500) console.error("Clientes que esfriaram:", error?.message || error);
  return NextResponse.json({ error: status >= 500 && error?.name !== "CooledClientError" ? "Não foi possível concluir." : error.message }, { status });
}
