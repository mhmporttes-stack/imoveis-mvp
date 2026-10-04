import EditorApp from "@/components/academia/editor/EditorApp";
import { requireBrokerManagementPage } from "@/lib/admin-auth";

export const metadata = {
  title: "Gestão da Academia · Matheus Machado",
  robots: { index: false, follow: false }
};

// Gestão de conteúdo (F3): só Admin e Gerente (ACA-1). O layout de /academia já aplica a chave e a sessão; aqui o guard de
// perfil (corretor/associado voltam à Academia). Em "Alterar conta" a tela abre em somente leitura. Toda escrita é validada
// de novo nas rotas /api/admin/academia/content e /grants.
export default async function AcademiaEditorPage() {
  const auth = await requireBrokerManagementPage("/academia");
  return <EditorApp readOnly={Boolean(auth.accountSwitchMode)} backHref="/academia" />;
}
