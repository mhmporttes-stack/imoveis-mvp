import AcademiaApp from "@/components/academia/AcademiaApp";

export const metadata = {
  title: "Academia · Matheus Machado",
  robots: { index: false, follow: false }
};

// Server Component fino: o app inteiro (cena, trilha, aula, questão) é um client component com
// dados de exemplo em memória (F1). Sem rede depois do carregamento.
export default function AcademiaPage() {
  return <AcademiaApp backHref="/admin/simulacoes" />;
}
