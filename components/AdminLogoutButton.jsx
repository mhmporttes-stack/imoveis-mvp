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
    await fetch("/api/admin/session", { method: "DELETE" });
    await getSupabaseBrowserClient()?.auth.signOut();
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <button
      className="premium-button-secondary"
      disabled={loading}
      onClick={signOut}
      type="button"
    >
      <LogOut className="mr-2 h-5 w-5" />
      {loading ? "Saindo..." : "Sair"}
    </button>
  );
}
