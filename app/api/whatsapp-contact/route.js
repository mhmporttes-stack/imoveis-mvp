import { NextResponse } from "next/server";
import { normalizeBrokerRef, resolveAdminProfileByRef } from "@/lib/admin-profiles";
import { DEFAULT_SIMULATION_BROKER_REF } from "@/lib/simulation-registrations";
import { toWhatsAppDigits } from "@/lib/phone-utils";

export const runtime = "nodejs";

function officialDigits() {
  let digits = String(process.env.WHATSAPP_DISPLAY_PHONE_NUMBER || "").replace(/\D/g, "");
  if (digits && !(digits.startsWith("55") && digits.length >= 12)) digits = `55${digits}`;
  return digits || null;
}

// Botão "Receber minha simulação" da tela final do formulário: cada link de
// corretor (?ref=) deve levar o cliente para o WhatsApp PESSOAL daquele
// corretor, não para o número oficial genérico — inclusive sem ref nenhum
// (link padrão do site vai pro corretor "matheus", o mesmo default já usado
// ao gravar o responsável do cadastro em resolveResponsibleUserIdFromPayload).
// Link de equipe (roleta, ?ref=equipe) sorteia um corretor diferente a cada
// envio, então continua indo pro número oficial (não dá pra saber de antemão
// quem vai atender). Corretor inativo ou sem telefone cadastrado também cai
// no número oficial, nunca quebra o botão.
export async function GET(request) {
  const rawRef = new URL(request.url).searchParams.get("ref") || "";
  const ref = normalizeBrokerRef(rawRef);

  if (ref !== "equipe") {
    const profile = await resolveAdminProfileByRef(ref || DEFAULT_SIMULATION_BROKER_REF, "simulation");
    const brokerDigits = profile?.status === "active" ? toWhatsAppDigits(profile.phone) : "";
    if (brokerDigits) {
      return NextResponse.json({ phone: brokerDigits }, { headers: { "Cache-Control": "no-store" } });
    }
  }

  return NextResponse.json(
    { phone: officialDigits() },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } }
  );
}
