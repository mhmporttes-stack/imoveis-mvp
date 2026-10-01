import { cx } from "./cx";

// Estado vazio/erro como convite à ação (padroes-crm.md §Estados).
// tone="danger" para erro: diga o que aconteceu e como resolver.
export default function EmptyState({ icon: Icon = null, title, description = "", action = null, tone = "neutral", className = "" }) {
  const iconTone = tone === "danger" ? "bg-danger-soft text-danger" : "bg-info-soft text-info";
  return (
    <div className={cx("flex flex-col items-center px-4 py-10 text-center", className)} role={tone === "danger" ? "alert" : undefined}>
      {Icon ? (
        <span className={cx("mb-4 inline-flex h-12 w-12 items-center justify-center rounded-card", iconTone)}>
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
      ) : null}
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-ink-2">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
