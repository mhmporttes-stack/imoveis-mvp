export default function SectionHeading({ eyebrow, title, subtitle, action, titleClassName = "", subtitleClassName = "" }) {
  return (
    <div className="container-page mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
      <div>
        {eyebrow ? <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">{eyebrow}</p> : null}
        <h2 className={`mt-3 max-w-3xl text-4xl font-extrabold leading-tight text-navy md:text-5xl ${titleClassName}`}>{title}</h2>
        {subtitle ? <p className={`mt-4 max-w-2xl text-lg leading-8 text-muted ${subtitleClassName}`}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
