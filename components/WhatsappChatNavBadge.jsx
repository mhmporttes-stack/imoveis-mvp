"use client";

import Link from "next/link";
import { useWhatsappChatSummary } from "@/components/useWhatsappChatSummary";

// Item "Chat" do submenu de Automações com o indicador de não lidas.
export default function WhatsappChatNavBadge({ active }) {
  const { summary } = useWhatsappChatSummary();
  const unread = summary.unreadMessages || 0;

  return (
    <Link
      href="/admin/automacoes?tab=whatsapp-chat"
      className={`inline-flex items-center gap-1.5 rounded-[10px] px-4 py-1.5 text-center text-[13px] font-black ${active ? "bg-navy text-white" : "text-navy"}`}
    >
      Chat
      {unread > 0 ? (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] leading-5 text-white" aria-label={`${unread} mensagens não lidas`}>
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
