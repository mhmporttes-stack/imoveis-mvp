import { Mail, MapPin } from "lucide-react";
import Link from "next/link";
import { whatsappMessageLink } from "@/lib/format";
import { COMPANY_MAPS_URL } from "@/lib/company-info.mjs";

const contactCardClass =
  "inline-flex min-h-[60px] w-full max-w-full min-w-0 items-center gap-3 overflow-hidden rounded-2xl border border-white/10 px-3 py-3 text-white/75 transition duration-300 hover:border-blue-200/45 hover:bg-white/5 hover:text-white sm:px-4 lg:w-[440px]";

const contactTextClass =
  "min-w-0 whitespace-nowrap text-[clamp(0.58rem,2.35vw,0.92rem)] font-bold leading-none";

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-[#071f38] pb-[calc(76px+env(safe-area-inset-bottom))] text-white md:mt-28 md:pb-0">
      <div className="container-page grid gap-10 py-14 lg:grid-cols-[1fr_0.55fr_minmax(360px,440px)]">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-200">Matheus Machado · CRECI 323106-F</p>
          <h2 className="mt-4 max-w-xl text-3xl font-extrabold leading-tight">Especialista no mercado imobiliário de Marília.</h2>
          <p className="mt-4 max-w-xl text-white/70">Simulação de financiamento, aprovação de crédito e acompanhamento personalizado durante todo o processo.</p>
        </div>

        <div>
          <h3 className="font-extrabold">Navegação</h3>
          <div className="mt-4 grid gap-3 text-white/75">
            {/* Links com ?situacao= abrem a lista já filtrada (PropertyExplorer); <a> comum para recarregar o filtro. */}
            <Link className="transition hover:text-white" href="/">Início</Link>
            <a className="transition hover:text-white" href="/?situacao=planta#imoveis">Imóveis na planta</a>
            <a className="transition hover:text-white" href="/?situacao=pronto#imoveis">Imóveis prontos</a>
            <Link className="transition hover:text-white" href="/simulacao">Simular financiamento</Link>
            <Link className="transition hover:text-white" href="/venda-seu-imovel">Vender meu imóvel</Link>
          </div>
        </div>

        <div>
          <h3 className="font-extrabold">Contato</h3>
          <div className="mt-4 grid max-w-full gap-3 text-white/75">
            <a
              href={whatsappMessageLink()}
              target="_blank"
              rel="noopener noreferrer"
              className={contactCardClass}
            >
              <WhatsAppIcon className="h-5 w-5 shrink-0 text-[#25D366]" />
              <span className={contactTextClass}>(14) 9 9105-6706</span>
            </a>
            <a
              href="mailto:MATHEUS.MACHADO.MARILIA@GMAIL.COM"
              className={contactCardClass}
            >
              <Mail className="h-5 w-5 shrink-0 text-blue-200" />
              <span className={contactTextClass}>MATHEUS.MACHADO.MARILIA@GMAIL.COM</span>
            </a>
            <a
              href={COMPANY_MAPS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={contactCardClass}
            >
              <MapPin className="h-5 w-5 shrink-0 text-blue-200" />
              <span className={contactTextClass}>Av. Ipiranga Nº 147</span>
            </a>
            {/* Instagram saiu do botão flutuante e mora aqui (2026-10-15). */}
            <a
              href="https://www.instagram.com/mhm.machado/"
              target="_blank"
              rel="noopener noreferrer"
              className={contactCardClass}
            >
              <InstagramIcon className="h-5 w-5 shrink-0 text-blue-200" />
              <span className={contactTextClass}>@mhm.machado</span>
            </a>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 py-5">
        <div className="container-page flex flex-col items-center justify-between gap-4 text-sm text-white/55 sm:flex-row">
          <span>© {new Date().getFullYear()} Matheus Machado Corretor de Imóveis.</span>
          {/* Entrada da equipe, discreta: o cliente não precisa dela. */}
          <Link href="/admin" className="text-xs font-semibold text-white/35 transition hover:text-white/70">
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

function InstagramIcon({ className }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="none">
      <rect x="7" y="7" width="18" height="18" rx="5.5" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="16" cy="16" r="4.2" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="21.3" cy="10.8" r="1.55" fill="currentColor" />
    </svg>
  );
}
