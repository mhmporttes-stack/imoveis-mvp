import { redirect } from "next/navigation";

// WhatsApp Master foi unificado dentro de Automações (aba própria) — este
// endereço antigo só redireciona, pra não quebrar links/favoritos já
// salvos.
export default function WhatsappMasterRedirectPage() {
  redirect("/admin/automacoes?tab=whatsapp-master");
}
