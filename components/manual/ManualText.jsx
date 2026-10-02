import { parseSafeText } from "@/lib/manual-ui-core.mjs";

// Renderiza o corpo do Manual como TEXTO: cada trecho vira nó de texto do
// React (escapado). Nunca interpreta HTML.
export default function ManualText({ body }) {
  const blocks = parseSafeText(body);
  if (!blocks.length) return <p className="text-sm text-muted">Sem conteúdo ainda.</p>;
  return (
    <div className="max-w-[72ch] space-y-3 text-[15px] leading-relaxed text-ink-2">
      {blocks.map((block, index) => {
        if (block.type === "h") return <h4 key={index} className="pt-1 text-sm font-semibold text-navy">{block.text}</h4>;
        if (block.type === "ul") return <ul key={index} className="list-disc space-y-1.5 pl-5 marker:text-brand/60">{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul>;
        if (block.type === "ol") return <ol key={index} className="list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-brand">{block.items.map((item, i) => <li key={i}>{item}</li>)}</ol>;
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}
