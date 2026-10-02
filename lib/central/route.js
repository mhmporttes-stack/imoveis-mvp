import "server-only";
import { NextResponse } from "next/server";
import { createHandlers, MAX_BODY_BYTES } from "./core.mjs";
import { createSupabaseCentralStore } from "./store-supabase";

// Cola fina entre uma rota /api/central/* e o nucleo. Nunca le cookies: so o cabecalho Authorization.
export async function handleCentral(request, op, id) {
  const length = Number(request.headers.get("content-length") || 0);
  let rawBody = "";
  if (length > MAX_BODY_BYTES) {
    rawBody = "x".repeat(MAX_BODY_BYTES + 1); // o nucleo responde 413 (apos checar credencial)
  } else if (request.method !== "GET") {
    rawBody = await request.text();
  }
  const handlers = createHandlers({ store: createSupabaseCentralStore(), env: process.env });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const result = await handlers[op]({ headers: request.headers, rawBody, ip, id });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
