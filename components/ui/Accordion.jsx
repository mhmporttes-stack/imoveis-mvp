"use client";

import { ChevronDown } from "lucide-react";
import { cx } from "./cx";

// Accordion acessível sobre <details>/<summary> nativos (teclado e leitor de
// tela de graça). Controlado: o pai decide quais itens estão abertos, o que
// permite abrir direto por âncora.
//   items: [{ id, title, badge?, children }]   openIds: string[]
export default function Accordion({ items, openIds = [], onToggle, className = "" }) {
  return (
    <div className={cx("divide-y divide-line overflow-hidden rounded-card border border-line bg-white", className)}>
      {items.map((item) => {
        const open = openIds.includes(item.id);
        return (
          <details key={item.id} id={item.id} open={open} className="group scroll-mt-24">
            <summary
              onClick={(event) => { event.preventDefault(); onToggle?.(item.id, !open); }}
              className="flex min-h-touch cursor-pointer list-none items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-out-ui hover:bg-mist/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand motion-reduce:transition-none [&::-webkit-details-marker]:hidden"
            >
              <span className="min-w-0 flex-1 text-[15px] font-semibold text-navy">{item.title}</span>
              {item.badge}
              <ChevronDown className={cx("h-4 w-4 shrink-0 text-muted transition-transform duration-200 ease-out-ui motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
            </summary>
            <div className="border-t border-line/70 bg-white px-4 pb-5 pt-4">{item.children}</div>
          </details>
        );
      })}
    </div>
  );
}
