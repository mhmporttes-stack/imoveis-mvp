import AppLauncher from "@/components/FinanceiroLauncher";

// Página de instalação/entrada do atalho "Chat" (mesma proposta do /financeiro). Não lê dado nenhum:
// no app instalado redireciona para o Chat do painel (login e permissões normais).
export default function ChatAppEntryPage() {
  return <AppLauncher app="chat" />;
}
