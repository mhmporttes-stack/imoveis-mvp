import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { isAcademyEnabled } from "@/lib/academy-flags";

export const dynamic = "force-dynamic";

// Sobrescreve o viewport do layout raiz (zoom travado): na Academia o zoom é
// liberado (WCAG 1.4.4). Os demais campos do raiz continuam herdados.
export const viewport = {
  maximumScale: 5,
  userScalable: true
};

export default async function AcademiaLayout({ children }) {
  // Chave desligada: a rota simplesmente não existe (404), antes de qualquer
  // checagem de sessão.
  if (!isAcademyEnabled()) notFound();
  // Mesmo login do CRM (cookies path "/"). requireAdminPage não aceita
  // fallback; sem sessão válida redireciona a /admin/login.
  await requireAdminPage();

  // Sem cabeçalho/menu do CRM: a Academia desenha o próprio shell (cena de tela cheia).
  return children;
}
