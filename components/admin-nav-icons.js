import {
  BarChart3, BookOpen, Building, Building2, Calculator, CalendarDays, CircleDot, FileText, GraduationCap, House, HousePlus, Link2,
  Megaphone, MessageCircle, MessageSquarePlus, MessageSquareQuote, Mic, Radar, RotateCcw, Route, Search, ShieldCheck, Snowflake,
  BrainCircuit, Store, Target, Trophy, UserCheck, UserRoundPlus, Users, UsersRound, Wallet, Zap
} from "lucide-react";
import { MarketplaceChatIcon } from "@/components/marketplace/MarketplaceChatShortcut";

// Ícone de cada destino do menu, por chave de `getAdminMenuGroups` (components/AdminMenu.jsx). Fonte única para o
// menu lateral do computador e para a barra inferior / folha "Mais" do celular (visual novo, dono, 2026-10-22).
// Só apresentação — destinos, ordem e permissões vêm do próprio menu.
export const ADMIN_NAV_ICONS = {
  inicio: House,
  "daily-goal": Target,
  "daily-goal-admin": Target,
  simulations: Users,
  "new-client": UserRoundPlus,
  chat: MessageCircle,
  "marketplace-chat": MarketplaceChatIcon,
  calendar: CalendarDays,
  prospecting: Search,
  properties: House,
  "new-property": HousePlus,
  developments: Building2,
  "management-properties": Building,
  captacoes: Radar,
  testimonials: MessageSquareQuote,
  "new-testimonial": MessageSquarePlus,
  "properties-catalog": House,
  brokers: UsersRound,
  "campaign-links": Link2,
  "client-journey": Route,
  automations: Zap,
  "attendance-guide": BookOpen,
  manual: BookOpen,
  performance: BarChart3,
  "daily-report": FileText,
  financial: Wallet,
  online: UserCheck,
  audit: ShieldCheck,
  "ai-usage": BrainCircuit,
  scoring: Trophy,
  "document-rules": FileText,
  alexa: Mic,
  academy: GraduationCap,
  "caixa-simulator": Calculator,
  ads: Megaphone,
  reentries: RotateCcw,
  "cooled-clients": Snowflake,
  marketplace: Store
};

export function navIconFor(key) {
  return ADMIN_NAV_ICONS[key] || CircleDot;
}

// Contador de cada destino (mesmas fontes do menu de antes: resumo do Chat, Chat Marketplace e /api/admin/crm-badge-counts).
export function navBadgeFor(key, counts) {
  if (key === "chat") return counts.chat || 0;
  if (key === "marketplace-chat") return counts.marketplace || 0;
  if (key === "calendar") return counts.agenda || 0;
  if (key === "simulations") return (counts.newAttendances || 0) + (counts.awaitingSimulation || 0) + (counts.prospectingReplies || 0);
  return 0;
}
