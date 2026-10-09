import FinanceiroLauncher from "@/components/FinanceiroLauncher";

// Página de instalação/entrada do atalho "Financeiro". Não lê dado nenhum: no app instalado
// redireciona para o Financeiro do painel (que aplica login e permissões normais).
export default function FinanceiroEntryPage() {
  return <FinanceiroLauncher />;
}
