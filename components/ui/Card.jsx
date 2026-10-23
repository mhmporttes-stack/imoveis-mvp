import { cx } from "./cx";

// Superfície padrão: borda sutil, sem sombra (profundidade só no que
// flutua — sistema-visual.md §3). `as` permite section/article/li.
// Visual novo (dono, 2026-10-22): raio 16px (rounded-card) e, com `title`, cabeçalho de painel
// "título + nota". Os cards entram por rolagem (data-reveal, components/motion/AdminScrollReveal.jsx).
export default function Card({ as: Tag = "div", padding = "md", title = null, note = null, actions = null, className = "", children, ...props }) {
  const paddings = { none: "", sm: "p-3", md: "p-4 sm:p-5", lg: "p-5 sm:p-6" };
  return (
    <Tag data-reveal="" className={cx("rounded-card border border-line bg-white", paddings[padding] ?? paddings.md, className)} {...props}>
      {title || note || actions ? (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {title ? <h3 className="min-w-0 text-[15px] font-extrabold leading-snug text-ink">{title}</h3> : null}
          {note ? <span className="text-xs text-muted">{note}</span> : null}
          {actions ? <div className="ml-auto flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}
