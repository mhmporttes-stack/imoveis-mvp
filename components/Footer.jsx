import { Mail } from "lucide-react";
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-28 border-t border-line bg-[#071f38] text-white">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.1fr_0.7fr_0.8fr]">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-200">Matheus Machado · CRECI 323106</p>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold leading-tight">Consultoria imobiliária em Marília com padrão profissional.</h2>
          <p className="mt-4 max-w-xl text-white/70">Empreendimentos, simulação, documentação e atendimento direto para quem busca comprar com mais segurança.</p>
        </div>

        <div>
          <h3 className="font-extrabold">Navegação</h3>
          <div className="mt-4 grid gap-3 text-white/75">
            <Link className="transition hover:text-white" href="/">Início</Link>
            <Link className="transition hover:text-white" href="/#empreendimentos">Imóveis na Planta</Link>
            <Link className="transition hover:text-white" href="/#todos">Imóveis Prontos</Link>
          </div>
        </div>

        <div>
          <h3 className="font-extrabold">Contato</h3>
          <div className="mt-4 grid gap-4 text-white/75">
            <span>Marília, SP</span>
            <a
              href="https://wa.me/5514998407380"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-3 rounded-2xl border border-white/10 px-4 py-3 transition duration-300 hover:border-[#25D366]/50 hover:bg-white/5 hover:text-white"
            >
              <WhatsAppIcon className="h-5 w-5 shrink-0 text-[#25D366]" />
              <span className="font-bold">(14) 9 9840-7380</span>
            </a>
            <a
              href="mailto:MATHEUS.MACHADO.MARILIA@GMAIL.COM"
              className="inline-flex items-center gap-3 rounded-2xl border border-white/10 px-4 py-3 transition duration-300 hover:border-blue-300/50 hover:bg-white/5 hover:text-white"
            >
              <Mail className="h-5 w-5 shrink-0 text-blue-200" />
              <span className="break-all font-bold">MATHEUS.MACHADO.MARILIA@GMAIL.COM</span>
            </a>
            <span>Atendimento personalizado</span>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 py-5">
        <div className="container-page flex flex-col items-center justify-between gap-4 text-sm text-white/55 sm:flex-row">
          <span>© {new Date().getFullYear()} Matheus Machado - Corretor de Imóveis.</span>
          <Link
            href="/admin"
            className="rounded-full border border-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white/45 transition duration-300 hover:border-white/25 hover:text-white/75"
          >
            Acesso administrativo
          </Link>
        </div>
      </div>
    </footer>
  );
}

function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.04 3.2A12.74 12.74 0 0 0 5.2 22.65L3.72 28l5.48-1.43A12.75 12.75 0 1 0 16.04 3.2Zm0 2.27a10.47 10.47 0 0 1 8.86 16.04 10.47 10.47 0 0 1-14.96 2.74l-.39-.24-3.25.85.87-3.16-.26-.41A10.46 10.46 0 0 1 16.04 5.47Zm-4.45 5.62c-.22 0-.58.08-.88.42-.3.34-1.15 1.12-1.15 2.74s1.18 3.18 1.34 3.4c.16.22 2.27 3.64 5.63 4.96 2.79 1.1 3.36.88 3.96.82.6-.05 1.94-.79 2.21-1.55.27-.76.27-1.42.19-1.55-.08-.14-.3-.22-.63-.38-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.04 1.29-.19.22-.38.25-.71.08-.33-.16-1.38-.51-2.63-1.62-.97-.86-1.63-1.93-1.82-2.26-.19-.33-.02-.5.14-.67.15-.15.33-.38.49-.57.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.57-.08-.16-.74-1.79-1.01-2.45-.27-.64-.54-.55-.74-.56h-.63Z" />
    </svg>
  );
}
