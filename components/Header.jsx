import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[#D8E2EE] bg-white/95 backdrop-blur-2xl">
      <div className="container-wide flex min-h-20 items-center justify-center py-3">
        <nav className="flex min-w-0 items-center justify-center gap-1 overflow-x-auto py-1 text-[0.78rem] font-extrabold text-ink sm:gap-3 sm:text-base">
          <Link href="/" className="rounded-full px-2.5 py-3 transition duration-300 hover:bg-[#EAF3FF] hover:text-brand sm:px-4">
            Início
          </Link>
          <Link href="/#empreendimentos" className="rounded-full px-2.5 py-3 transition duration-300 hover:bg-[#EAF3FF] hover:text-brand sm:px-4">
            Imóveis na Planta
          </Link>
          <Link href="/#todos" className="rounded-full px-2.5 py-3 transition duration-300 hover:bg-[#EAF3FF] hover:text-brand sm:px-4">
            Imóveis Prontos
          </Link>
        </nav>
      </div>
    </header>
  );
}
