export default function SectionHeading({ eyebrow, title, subtitle, action, titleClassName = "", subtitleClassName = "" }) {
  return (
    <div className="container-page mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">{eyebrow}</p> : null}
        <h2 className={`mt-3 max-w-[1220px] text-[clamp(2rem,2.9vw,2.85rem)] font-extrabold leading-[1.04] text-navy ${titleClassName}`}>{title}</h2>
        {subtitle ? <p className={`mt-4 max-w-[1080px] text-[clamp(1rem,1.25vw,1.125rem)] leading-8 text-muted ${subtitleClassName}`}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
