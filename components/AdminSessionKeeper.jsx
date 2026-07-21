"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const SESSION_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export default function AdminSessionKeeper() {
  const pathname = usePathname();
  const router = useRouter();
  const shouldCheckSession =
    pathname?.startsWith("/admin") &&
    !pathname?.startsWith("/admin/login") &&
    !pathname?.startsWith("/admin/reset-password");

  useEffect(() => {
    if (!shouldCheckSession) return undefined;

    let cancelled = false;

    async function checkSession() {
      try {
        const response = await fetch("/api/admin/session", {
          cache: "no-store",
          credentials: "same-origin"
        });

        if (cancelled || response.ok) return;

        await getSupabaseBrowserClient()?.auth.signOut();

        if (response.status === 403) {
          router.replace("/admin/login?error=unauthorized");
          router.refresh();
          return;
        }

        if (response.status === 401) {
          router.replace("/admin/login?error=session");
          router.refresh();
        }
      } catch {
        // Network interruptions are handled by the PWA/offline status. Do not log personal data.
      }
    }

    checkSession();
    const interval = window.setInterval(checkSession, SESSION_REFRESH_INTERVAL_MS);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        checkSession();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router, shouldCheckSession]);

  return null;
}
