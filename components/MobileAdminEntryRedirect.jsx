"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const ENTRY_KEY = "mm_mobile_admin_entry_handled";

export default function MobileAdminEntryRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const isMobileApp = window.navigator.standalone === true
      || window.matchMedia("(display-mode: standalone)").matches
      || window.matchMedia("(max-width: 767px)").matches;
    if (!isMobileApp) return;

    if (pathname !== "/admin") {
      window.sessionStorage.setItem(ENTRY_KEY, "1");
      return;
    }

    if (window.sessionStorage.getItem(ENTRY_KEY) === "1") return;

    window.sessionStorage.setItem(ENTRY_KEY, "1");
    router.replace("/admin/simulacoes");
  }, [pathname, router]);

  return null;
}
