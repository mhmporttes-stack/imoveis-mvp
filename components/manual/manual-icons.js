import { BookOpen, Calculator, CalendarDays, Ellipsis, FileText, MessageCircle, Target, Trophy, Users } from "lucide-react";

const ICONS = { calculator: Calculator, calendar: CalendarDays, file: FileText, message: MessageCircle, more: Ellipsis, target: Target, trophy: Trophy, users: Users };

// Nome (texto do banco) -> ícone; desconhecido cai em livro (nunca "?").
export function topicIcon(name) {
  return ICONS[String(name || "").toLowerCase()] || BookOpen;
}
