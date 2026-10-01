import { cx } from "./cx";

// Bloco de carregamento com o formato do conteúdo (evita pulo de layout).
export default function Skeleton({ className = "", rounded = "rounded-chip" }) {
  return <span aria-hidden="true" className={cx("block animate-pulse bg-neutral-soft motion-reduce:animate-none", rounded, className)} />;
}

// Linhas de lista em carregamento, com anúncio para leitor de tela.
export function SkeletonList({ rows = 4, label = "Carregando…" }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10" rounded="rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
