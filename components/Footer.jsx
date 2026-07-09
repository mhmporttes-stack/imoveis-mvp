import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-28 border-t border-line bg-[#071f38] text-white">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.1fr_0.7fr_0.7fr]">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-200">Matheus Machado · CRECI 323106</p>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold leading-tight">Consultoria imobiliária em Marília com padrão profissional.</h2>
          <p className="mt-4 max-w-xl text-white/70">Empreendimentos, simulação, documentação e atendimento direto para quem busca comprar com mais segurança.</p>
        </div>
        <div>
          <h3 className="font-extrabold">Navegação</h3>
          <div className="mt-4 grid gap-3 text-white/75">
            <Link href="/">Home</Link>
            <Link href="/#todos">Todos os empreendimentos</Link>
            <Link href="/admin">Área administrativa</Link>
          </div>
        </div>
        <div>
          <h3 className="font-extrabold">Contato</h3>
          <div className="mt-4 grid gap-3 text-white/75">
            <span>Marília, SP</span>
            <span>WhatsApp sob consulta</span>
            <span>Atendimento personalizado</span>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-sm text-white/55">
        © {new Date().getFullYear()} Matheus Machado - Corretor de Imóveis.
      </div>
    </footer>
  );
}
