import { CalendarDays, CircleDot, MessageCircle, MessageSquareReply, UserRoundPlus } from "lucide-react";

// Itens da lista "Pendências" (mesmos números e destinos) — fonte única do balão do cabeçalho (CrmBreakdown,
// components/AdminMenu.jsx) e do bloco de pendências da tela Início. Só os itens com contagem > 0.
export function crmPendingItems(counts = {}, { hideChat = false } = {}) {
  return [
    { label: "Chat", count: counts.chat, href: "/admin/chat", Icon: MessageCircle },
    { label: "Agenda", count: counts.agenda, href: "/admin/calendario?pending=1", Icon: CalendarDays },
    { label: "Novos atendimentos", count: counts.newAttendances, href: "/admin/simulacoes?needsFirstContact=1", Icon: UserRoundPlus },
    { label: "Aguardando simulação", count: counts.awaitingSimulation, href: "/admin/simulacoes?status=pending", Icon: CircleDot },
    { label: "Respostas da prospecção", count: counts.prospectingReplies, href: "/admin/simulacoes?prospectingReplies=1", Icon: MessageSquareReply }
  ].filter((item) => item.count > 0 && !(hideChat && item.label === "Chat"));
}
