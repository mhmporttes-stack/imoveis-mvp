import { NextResponse } from "next/server";

export function alertErrorResponse(error) {
  const status = error?.name === "CrmAlertError" ? error.status : 500;
  if (status === 500) console.error("Central de Alertas:", error?.message || error);
  return NextResponse.json({ error: status === 500 ? "Não foi possível concluir." : error.message }, { status });
}
