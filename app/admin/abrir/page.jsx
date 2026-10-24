import { redirect } from "next/navigation";
import { isOwnerAdminEmail, requireAdminPage } from "@/lib/admin-auth";
import { resolvePanelEntryPath } from "@/lib/painel-entrada-core.mjs";

export const dynamic = "force-dynamic";

// Porta de entrada do painel (regra do dono, 2026-10-24 — docs/BUSINESS_RULES.md INI-6): start_url do app "Painel"
// (app/manifest.js), endereço inicial do app de desktop (desktop-app/src/core.js CRM_HOME) e destino depois do
// login/2FA. Dono (conta real, fora de "Alterar conta") → Início; demais perfis → o destino de antes (Clientes no
// celular/app; /admin no computador, com ?de=computador). Não grava nada.
export default async function PainelEntradaPage({ searchParams }) {
  const auth = await requireAdminPage();
  const query = await searchParams;
  redirect(resolvePanelEntryPath({
    ok: auth.ok,
    accountSwitchMode: auth.accountSwitchMode,
    isOwner: isOwnerAdminEmail(auth.user?.email),
    device: query?.de === "computador" ? "computador" : "celular"
  }));
}
