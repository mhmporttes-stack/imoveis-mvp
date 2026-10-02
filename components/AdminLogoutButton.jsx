"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AdminLogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    // Desassocia o push deste navegador de quem está saindo (a sessão ainda é
    // válida aqui, então o servidor confere o dono). Evita que o aviso privado
    // dele apareça para o próximo usuário do aparelho.
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      const subscription = await registration?.pushManager?.getSubscription();
      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        }).catch(() => {});
        await subscription.unsubscribe().catch(() => {});
      }
    } catch {
      // Sem push/SW: segue o logout normalmente.
    }
    await fetch("/api/admin/session", { method: "DELETE" });
    await getSupabaseBrowserClient()?.auth.signOut();
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <button
      className="admin-logout-button premium-button-secondary"
      disabled={loading}
      onClick={signOut}
      type="button"
    >
      <LogOut className="mr-2 h-5 w-5" />
      {loading ? "Saindo..." : "Sair"}
    </button>
  );
}
