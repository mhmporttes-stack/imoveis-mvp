import Badge from "@/components/ui/Badge";

// Spinner girando; com "reduzir movimento" vira uma bolinha pulsando suave.
function PillSpinner() {
  return (
    <>
      <svg className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:hidden" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="hidden h-1.5 w-1.5 shrink-0 rounded-full bg-accent motion-reduce:block motion-reduce:animate-pulse" aria-hidden="true" />
    </>
  );
}

// Pílula de estado do painel, centralizada logo acima da barra inferior (respeita a área segura do iPhone e a barra):
// "Atualizando…" (tela mostrando o guardado no aparelho — DeviceCacheRefreshing) e "Carregando…" (troca de tela pelo menu —
// NavigationPill). Não bloqueia toque nem rolagem.
export default function FloatingStatusPill({ label, className = "z-30", ...props }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 flex justify-center px-4 ${className}`}
      style={{ bottom: "calc(max(env(safe-area-inset-bottom), var(--admin-bottom-nav-space, 0px)) + 12px)" }}
      {...props}
    >
      <Badge tone="info" icon={PillSpinner} className="shadow-soft">{label}</Badge>
    </div>
  );
}
