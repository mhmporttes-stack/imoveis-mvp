import Link from "next/link";
import { Suspense } from "react";
import PropertyCaptureForm from "@/components/captacoes/PropertyCaptureForm";

export const metadata = {
  title: "Venda seu imóvel | Matheus Machado Imóveis",
  description: "Cadastre seu imóvel para análise de venda com Matheus Machado Imóveis."
};

export default function VendaSeuImovelPage() {
  return (
    <main className="bg-mist py-12 md:py-16">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.22em] text-brand">Captação de imóveis</p>
          <h1 className="mt-3 text-[clamp(2.5rem,6vw,5rem)] font-black leading-[0.95] text-navy">
            Venda seu imóvel
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted">
            Envie os dados principais do seu imóvel. A análise será feita com cuidado para entender valor, perfil e melhor estratégia de venda.
          </p>
        </div>
        <Link href="/" className="premium-button-secondary">
          Voltar ao site
        </Link>
      </section>

      <Suspense fallback={<div className="container-page rounded-[24px] bg-white p-8 text-navy shadow-soft">Carregando formulário...</div>}>
        <PropertyCaptureForm />
      </Suspense>
    </main>
  );
}
