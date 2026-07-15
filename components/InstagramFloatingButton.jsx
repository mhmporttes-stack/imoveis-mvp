"use client";

import { usePathname } from "next/navigation";

const instagramUrl = "https://www.instagram.com/mhm.machado/";

export default function InstagramFloatingButton() {
  const pathname = usePathname();

  if (pathname?.startsWith("/admin")) {
    return null;
  }

  return (
    <a
      href={instagramUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Acessar Instagram de Matheus Machado"
      title="Acessar Instagram"
      className="group fixed bottom-[calc(1rem+env(safe-area-inset-bottom)+66px)] right-4 z-[100] grid h-[52px] w-[52px] place-items-center rounded-full bg-[radial-gradient(circle_at_30%_105%,#FEDA75_0%,#FA7E1E_28%,#D62976_52%,#962FBF_74%,#4F5BD5_100%)] text-white shadow-[0_18px_45px_rgba(150,47,191,0.28)] transition duration-300 hover:-translate-y-1 hover:scale-105 hover:shadow-[0_22px_60px_rgba(214,41,118,0.38)] focus:outline-none focus:ring-4 focus:ring-[#D62976]/25 sm:bottom-[calc(1.5rem+70px)] sm:right-6 sm:h-14 sm:w-14"
    >
      <span className="pointer-events-none absolute right-full top-1/2 mr-3 hidden -translate-y-1/2 whitespace-nowrap rounded-full bg-[#071f38] px-4 py-2 text-sm font-bold text-white opacity-0 shadow-[0_16px_40px_rgba(0,0,0,0.22)] transition duration-300 group-hover:opacity-100 sm:block">
        Instagram
      </span>
      <InstagramIcon className="h-7 w-7 sm:h-8 sm:w-8" />
    </a>
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
