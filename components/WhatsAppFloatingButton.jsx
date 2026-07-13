"use client";

import { usePathname } from "next/navigation";
import { whatsappMessageLink } from "@/lib/format";

const whatsappUrl =
  whatsappMessageLink("Olá, Matheus! Encontrei seu contato pelo site e gostaria de mais informações sobre os imóveis.");

export default function WhatsAppFloatingButton() {
  const pathname = usePathname();

  if (pathname?.startsWith("/admin")) {
    return null;
  }

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar com Matheus pelo WhatsApp"
      className="group fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-[100] grid h-[52px] w-[52px] place-items-center rounded-full bg-[#25D366] text-white shadow-[0_18px_45px_rgba(18,140,82,0.34)] transition duration-300 hover:-translate-y-1 hover:scale-105 hover:bg-[#20BF5A] hover:shadow-[0_22px_60px_rgba(18,140,82,0.46)] focus:outline-none focus:ring-4 focus:ring-[#25D366]/30 sm:bottom-6 sm:right-6 sm:h-14 sm:w-14"
    >
      <span className="pointer-events-none absolute right-full top-1/2 mr-3 hidden -translate-y-1/2 whitespace-nowrap rounded-full bg-[#071f38] px-4 py-2 text-sm font-bold text-white opacity-0 shadow-[0_16px_40px_rgba(0,0,0,0.22)] transition duration-300 group-hover:opacity-100 sm:block">
        Fale comigo no WhatsApp
      </span>
      <WhatsAppIcon className="h-7 w-7 sm:h-8 sm:w-8" />
    </a>
  );
}

function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.04 3.2A12.74 12.74 0 0 0 5.2 22.65L3.72 28l5.48-1.43A12.75 12.75 0 1 0 16.04 3.2Zm0 2.27a10.47 10.47 0 0 1 8.86 16.04 10.47 10.47 0 0 1-14.96 2.74l-.39-.24-3.25.85.87-3.16-.26-.41A10.46 10.46 0 0 1 16.04 5.47Zm-4.45 5.62c-.22 0-.58.08-.88.42-.3.34-1.15 1.12-1.15 2.74s1.18 3.18 1.34 3.4c.16.22 2.27 3.64 5.63 4.96 2.79 1.1 3.36.88 3.96.82.6-.05 1.94-.79 2.21-1.55.27-.76.27-1.42.19-1.55-.08-.14-.3-.22-.63-.38-.33-.16-1.94-.96-2.24-1.07-.3-.11-.52-.16-.74.16-.22.33-.85 1.07-1.04 1.29-.19.22-.38.25-.71.08-.33-.16-1.38-.51-2.63-1.62-.97-.86-1.63-1.93-1.82-2.26-.19-.33-.02-.5.14-.67.15-.15.33-.38.49-.57.16-.19.22-.33.33-.55.11-.22.05-.41-.03-.57-.08-.16-.74-1.79-1.01-2.45-.27-.64-.54-.55-.74-.56h-.63Z" />
    </svg>
  );
}
