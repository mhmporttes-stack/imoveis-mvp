import Link from "next/link";
import { ArrowRight, Handshake, Home } from "lucide-react";

export default function PropertyCaptureSection() {
  return (
    <section aria-labelledby="property-capture-title" className="mt-8 rounded-[28px] border border-line bg-white p-5 shadow-soft md:p-7">
      <div className="grid gap-6 xl:grid-cols-[1fr_auto] xl:items-start">
        <div className="flex gap-4 sm:gap-5">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#E9F2FF] text-brand">
            <Handshake className="h-7 w-7" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-brand">Venda seu imóvel</p>
            <h3 id="property-capture-title" className="mt-2 text-[clamp(1.85rem,3vw,3rem)] font-black leading-[1.03] text-navy">
              Quer vender seu imóvel?
            </h3>
            <p className="mt-3 max-w-[860px] text-base leading-7 text-muted sm:text-lg">
              Cadastre as principais informações do imóvel para análise e captação.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-[#F4F9FF] px-5 py-4 text-navy">
          <div className="flex items-center gap-2 text-sm font-black">
            <Home className="h-4 w-4 text-brand" aria-hidden="true" />
            Avaliação organizada
          </div>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
            As informações chegam direto no painel para contato, análise e publicação.
          </p>
        </div>
      </div>

      <div className="mt-7 border-t border-line pt-6">
        <Link
          href="/venda-seu-imovel"
          className="inline-flex min-h-13 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-navy to-brand px-7 py-4 text-sm font-black text-white shadow-lg shadow-brand/20 transition duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand/25 focus:outline-none focus:ring-4 focus:ring-brand/25"
        >
          Quero vender meu imóvel
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
