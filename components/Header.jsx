import Image from "next/image";
import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/80 bg-white/90 backdrop-blur-xl">
      <div className="container-wide flex min-h-24 items-center justify-between gap-6">
        <Link href="/" className="flex min-w-0 items-center gap-4">
          <span className="relative h-14 w-36 overflow-hidden rounded-2xl border border-line bg-mist">
            <Image src="/assets/matheus-machado-logo.png" alt="Matheus Machado" fill className="object-cover" priority />
          </span>
          <span className="hidden sm:block">
            <strong className="block text-2xl font-extrabold leading-none text-navy">Matheus Machado</strong>
            <small className="mt-2 block font-bold text-muted">Corretor de Imóveis · CRECI 323106</small>
          </span>
        </Link>

        <nav className="flex items-center gap-3">
          <Link href="/#empreendimentos" className="rounded-full border border-line px-5 py-3 font-extrabold text-ink transition hover:border-brand hover:text-navy">
            Empreendimentos
          </Link>
          <Link href="/admin" className="rounded-full bg-navy px-5 py-3 font-extrabold text-white transition hover:bg-[#082f55]">
            Painel
          </Link>
        </nav>
      </div>
    </header>
  );
}
