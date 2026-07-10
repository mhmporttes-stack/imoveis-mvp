import Image from "next/image";
import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[#D8E2EE] bg-white/95 backdrop-blur-2xl">
      <div className="container-wide flex min-h-24 items-center justify-between gap-5 py-3 lg:min-h-28">
        <Link href="/" className="group flex min-w-0 shrink-0 items-center">
          <span className="relative h-16 w-56 overflow-hidden rounded-xl bg-[#020712] shadow-[0_18px_45px_rgba(2,7,18,0.14)] transition duration-300 group-hover:-translate-y-0.5 sm:h-[76px] sm:w-72 lg:h-20 lg:w-80">
            <Image
              src="/assets/matheus-machado-logo-premium.jpeg"
              alt="Matheus Machado - Corretor de Imóveis"
              fill
              sizes="(max-width: 640px) 224px, 320px"
              className="object-contain"
              priority
            />
          </span>
        </Link>

        <nav className="flex min-w-0 items-center justify-end gap-2 overflow-x-auto py-2 text-sm font-extrabold text-ink sm:gap-3 sm:text-base">
          <Link href="/" className="rounded-full px-4 py-3 transition duration-300 hover:bg-[#EAF3FF] hover:text-brand">
            Início
          </Link>
          <Link href="/#empreendimentos" className="rounded-full px-4 py-3 transition duration-300 hover:bg-[#EAF3FF] hover:text-brand">
            Imóveis na Planta
          </Link>
          <Link href="/#todos" className="rounded-full px-4 py-3 transition duration-300 hover:bg-[#EAF3FF] hover:text-brand">
            Imóveis Prontos
          </Link>
          <Link href="/admin" className="rounded-full bg-navy px-5 py-3 text-white shadow-soft transition duration-300 hover:-translate-y-0.5 hover:bg-brand hover:shadow-premium">
            Painel
          </Link>
        </nav>
      </div>
    </header>
  );
}
