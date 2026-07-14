export default function SectionHeading({ eyebrow, title, subtitle, action, titleClassName = "", subtitleClassName = "" }) {
  return (
    <div className="container-page mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
      <div>
        {eyebrow ? <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">{eyebrow}</p> : null}
        <h2 className={`mt-3 max-w-5xl text-[clamp(2rem,3.4vw,3rem)] font-extrabold leading-[1.08] text-navy ${titleClassName}`}>{title}</h2>
        {subtitle ? <p className={`mt-4 max-w-4xl text-[clamp(1rem,1.35vw,1.125rem)] leading-8 text-muted ${subtitleClassName}`}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
