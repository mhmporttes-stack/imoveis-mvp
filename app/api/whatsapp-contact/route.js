import { NextResponse } from "next/server";
import { getReceiveSimulationContact } from "@/lib/simulation-registrations";
import { OFFICIAL_WHATSAPP_DIGITS } from "@/lib/official-whatsapp.mjs";
import { RECEIVE_CONTACT_STATE } from "@/lib/receive-simulation-contact.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Botão "Receber minha simulação" da tela final do formulário (WA-10, regra
// do dono 2026-10-01): abre o WhatsApp do corretor RESPONSÁVEL pelo cadastro
// que o cliente acabou de criar — inclusive quando quem atribuiu foi a
// roleta (link geral sem ?ref= ou ?ref=equipe). Nunca leva para outro
// corretor, para o Matheus nem para o número oficial "por reserva".
//
// Modo principal: ?registrationId=&token= (token = preferencesAccessToken
// devolvido pelo POST do cadastro). Respostas: { state: "ready", phone },
// { state: "waiting" } (fila de espera da roleta, sem responsável ainda — o
// botão consulta de novo) ou { state: "unavailable" } (responsável sem
// WhatsApp válido/inativo). Token inválido: 404.
//
// Modo antigo (sem registrationId — formulário sem token de acesso): só
// resolve o link PESSOAL (?ref=<corretor>), em que o responsável é sempre o
// dono do link; sem ref ou ?ref=equipe não há como saber o responsável aqui,
// então responde "unavailable" em vez de chutar um número.
export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const registrationId = params.get("registrationId") || "";
  const token = params.get("token") || "";

  try {
    if (registrationId) {
      const contact = await getReceiveSimulationContact(registrationId, token);
      if (!contact) return NextResponse.json({ error: "Cadastro não encontrado." }, { status: 404, headers: NO_STORE });
      // Dono, 2026-10-09: o cliente sempre chama o número OFICIAL (o corretor responsável atende pelo Chat). Não há mais fila
      // de espera nem "corretor sem WhatsApp": o botão fica pronto assim que o cadastro existe.
      return NextResponse.json({ state: RECEIVE_CONTACT_STATE.READY, phone: OFFICIAL_WHATSAPP_DIGITS }, { headers: NO_STORE });
    }
    // Sem cadastro identificado (formulário sem token de acesso): também o número oficial.
    return NextResponse.json({ state: RECEIVE_CONTACT_STATE.READY, phone: OFFICIAL_WHATSAPP_DIGITS }, { headers: NO_STORE });
  } catch (error) {
    console.error("Falha ao resolver o WhatsApp do botão Receber minha simulação:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível localizar o WhatsApp do seu corretor." }, { status: 500, headers: NO_STORE });
  }
}
