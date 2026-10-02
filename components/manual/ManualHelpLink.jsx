import Link from "next/link";
import { BookOpen } from "lucide-react";
import { manualHref } from "@/lib/manual-core.mjs";

// Ajuda contextual (arquitetura pronta; ainda não usada nas telas).
// Uso futuro: <ManualHelpLink topicSlug="meta-diaria" sectionSlug="como-bater-a-meta" />
// Leva ao subtópico exato do Manual (âncora /admin/manual#topico/subtopico).
export default function ManualHelpLink({ topicSlug, sectionSlug = "", label = "Ver no Manual", className = "" }) {
  return (
    <Link
      href={manualHref(topicSlug, sectionSlug)}
      className={`inline-flex min-h-touch items-center gap-1.5 rounded-control px-2 text-xs font-medium text-muted transition-colors duration-150 ease-out-ui hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${className}`}
    >
      <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}
