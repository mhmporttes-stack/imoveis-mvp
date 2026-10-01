import { cx } from "./cx";

// Superfície padrão: borda sutil, sem sombra (profundidade só no que
// flutua — sistema-visual.md §3). `as` permite section/article/li.
export default function Card({ as: Tag = "div", padding = "md", className = "", children, ...props }) {
  const paddings = { none: "", sm: "p-3", md: "p-4 sm:p-5", lg: "p-5 sm:p-6" };
  return (
    <Tag className={cx("rounded-card border border-line bg-white", paddings[padding] ?? paddings.md, className)} {...props}>
      {children}
    </Tag>
  );
}
