"use client";

import { useWhatsappChatSummary } from "@/components/useWhatsappChatSummary";

// Contador de mensagens não lidas do Chat — usado ao lado do item "Chat" do
// menu (e no botão do grupo). Não renderiza nada quando não há não lidas.
export default function WhatsappChatNavBadge({ className = "" }) {
  const { summary } = useWhatsappChatSummary();
  const unread = summary.unreadMessages || 0;
  if (unread <= 0) return null;

  return (
    <span
      className={`inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-black leading-5 text-white ${className}`}
      aria-label={`${unread} mensagens não lidas`}
    >
      {unread > 99 ? "99+" : unread}
    </span>
  );
}
