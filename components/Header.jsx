"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Cabeçalho fino do site público (2026-10-15): símbolo M oficial + os três caminhos do cliente.
// Fundo azul-marinho porque o símbolo tem traço claro e precisa de fundo escuro.
// Na home fica transparente sobre a abertura (sem faixa). Não é "sticky": no site o body usa overflow-x:hidden (globals.css), que anula o sticky; no celular a barra
// inferior (MobileActionBar) é que fica sempre à mão. Fica fora da simulação (só o questionário, dono 2026-10-05) e do atalho Financeiro.
const HIDDEN_PREFIXES = ["/simulacao", "/financeiro"];

const NAV = [
  { href: "/#imoveis", label: "Imóveis" },
  { href: "/simulacao", label: "Simular", highlight: true },
  { href: "/venda-seu-imovel", label: "Vender" }
];

export default function Header() {
  const pathname = usePathname() || "";
  if (HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

  // Na home o cabeçalho não tem faixa própria: fica transparente por cima do fundo da abertura (dono, 2026-10-15).
  // A seção de abertura (app/page.jsx) reserva a altura dele com pt-14/sm:pt-16. Nas outras páginas, faixa azul-marinho.
  const isHome = pathname === "/";

  return (
    <header className={`z-[80] text-white ${isHome ? "absolute inset-x-0 top-0 bg-transparent" : "relative border-b border-white/10 bg-[#061A2F]"}`}>
      <div className="container-page flex h-14 items-center justify-between gap-3 sm:h-16">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300/40" aria-label="Matheus Machado Imóveis, página inicial">
          <span className="relative block h-7 w-9 shrink-0 sm:h-8 sm:w-10">
            <Image src="/assets/matheus-machado-symbol.png" alt="" fill sizes="40px" className="object-contain" priority />
          </span>
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block truncate text-sm font-black uppercase tracking-[0.14em]">Matheus Machado</span>
            <span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-blue-200/80">Corretor de imóveis</span>
          </span>
        </Link>

        <nav aria-label="Principal" className="flex items-center gap-1 sm:gap-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex h-10 items-center rounded-full px-3.5 text-sm font-extrabold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300/40 sm:px-4 ${
                item.highlight ? "bg-white text-navy hover:bg-blue-50" : "text-white/85 hover:bg-white/10 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
