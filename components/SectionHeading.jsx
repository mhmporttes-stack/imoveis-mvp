// `centered` (dono, 2026-10-16): título, linha pequena e subtítulo centralizados na página (padrão continua à esquerda).
export default function SectionHeading({ eyebrow, title, subtitle, action, titleClassName = "", subtitleClassName = "", centered = false }) {
  return (
    <div className={`container-page mb-12 flex flex-col gap-6 ${centered ? "items-center text-center" : "justify-between md:flex-row md:items-end"}`}>
      <div className={`min-w-0 ${centered ? "" : "flex-1"}`}>
        {eyebrow ? <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">{eyebrow}</p> : null}
        <h2 className={`mt-3 ${centered ? "mx-auto" : ""} max-w-[1220px] text-[clamp(2rem,2.9vw,2.85rem)] font-extrabold leading-[1.04] text-navy ${titleClassName}`}>{title}</h2>
        {subtitle ? <p className={`mt-4 ${centered ? "mx-auto" : ""} max-w-[1080px] text-[clamp(1rem,1.25vw,1.125rem)] leading-8 text-muted ${subtitleClassName}`}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
