"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calculator } from "lucide-react";
import { siteWhatsappUrl } from "@/components/site/site-links";

// Barra fixa do celular (2026-10-15): as duas ações que o cliente procura, sempre ao alcance do polegar.
// "Falar com o corretor" abre o WhatsApp OFICIAL (lib/official-whatsapp.mjs, via whatsappMessageLink).
// Some no computador (lá fica o botão flutuante do WhatsApp) e nos formulários de captação, onde
// cobriria o botão de enviar. O rodapé reserva o espaço dela (Footer.jsx, padding inferior).
const HIDDEN_PREFIXES = ["/venda-seu-imovel", "/captacao", "/financeiro"];

export default function MobileActionBar() {
  const pathname = usePathname() || "";
  if (HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[95] border-t border-line bg-white/95 px-3 pb-[calc(0.6rem+env(safe-area-inset-bottom))] pt-2.5 shadow-float backdrop-blur md:hidden"
      role="region"
      aria-label="Ações rápidas"
    >
      <div className="mx-auto grid max-w-md grid-cols-2 gap-2.5">
        <Link
          href="/simulacao"
          className="inline-flex h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-navy px-2 text-sm font-extrabold text-white transition active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
        >
          <Calculator className="h-[18px] w-[18px]" aria-hidden="true" />
          Simular grátis
        </Link>
        <a
          href={siteWhatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[#25D366] px-2 text-sm font-extrabold text-[#06361C] transition active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366]/35"
        >
          <WhatsAppIcon className="h-5 w-5" />
          Falar com o corretor
        </a>
      </div>
    </div>
  );
}

function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.04 3.2A12.74 12.74 0 0 0 5.2 22.65L3.72 28l5.48-1.43A12.75 12.75 0 1 0 16.04 3.2Zm0 2.27a10.47 10.47 0 0 1 8.86 16.04 10.47 10.47 0 0 1-14.96 2.74l-.39-.24-3.25.85.87-3.16-.26-.41A10.46 10.46 0 0 1 16.04 5.47Zm-4.45 5.62c-.22 0-.58.08-.88.42-.3.34-1.15 1.12-1.15 2.74s1.18 3.18 1.34 3.4c.16.22 2.27 3.64 5.63 4.96 2.79 1.1 3.36.88 3.96.82.6-.05 1.94-.79 2.21-1.55.27-.76.27-1.42.19-1.55-.08-.14-.3-.22-.63-.38-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.04 1.29-.19.22-.38.25-.71.08-.33-.16-1.38-.51-2.63-1.62-.97-.86-1.63-1.93-1.82-2.26-.19-.33-.02-.5.14-.67.15-.15.33-.38.49-.57.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.57-.08-.16-.74-1.79-1.01-2.45-.27-.64-.54-.55-.74-.56h-.63Z" />
    </svg>
  );
}
