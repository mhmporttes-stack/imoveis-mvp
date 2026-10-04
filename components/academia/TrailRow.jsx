"use client";

import s from "./academia.module.css";
import Icon from "./Icon";

const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

// Uma linha da Trilha. 4 estados por FORMA + LUZ + TEXTO (nunca só cor):
// done (check) · now (disco marinho com halo) · next (anel) · locked (tracejado + cadeado).
export default function TrailRow({ row, open, onToggle, onOpen, onLocked, onCert }) {
  const common = { "data-fl": row.fl, style: { "--ox": "0px" } };
  if (row.t === "done") {
    return (
      <>
        <button type="button" className={`${s.row} ${s.done}`} {...common} aria-expanded={open}
          aria-label={`${row.part ? `Módulo ${row.m} em andamento, ${row.ix.length} de ${row.total} aulas concluídas` : `Módulo ${row.m}, concluído, ${plural(row.ix.length, "aula", "aulas")}`}. ${open ? "Ocultar" : "Ver"} aulas`}
          onClick={() => onToggle(row.m)}>
          <span className={s.nd}><Icon name="check" /></span>
          <span>{row.part ? `${row.ix.length} aulas do Módulo ${row.m}` : `Módulo ${row.m}`}</span>
          <span className={s.ex}><Icon name="down" /></span>
        </button>
        {open ? (
          <ul className={s.sub} data-fl={row.fl} aria-label={`Aulas do módulo ${row.m}`}>
            {row.lessons.map((l) => (
              <li key={l.id}><button type="button" onClick={() => onOpen(l.id)}><Icon name="check" />{l.title}</button></li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }
  if (row.t === "now") {
    return (
      <div className={`${s.row} ${s.cur}`} {...common} data-cur="1" role="group" aria-label="Agora">
        <span className={s.nd} aria-hidden="true"><i /></span>
        <span className={s.ey}>Agora · Módulo {row.m}</span>
        <span className={s.tt}>{row.title}</span>
        <span className={s.mt}>{row.label} · {row.minutes} min</span>
        <button type="button" className={`${s.btn} ${s.sm} ${s.go}`} onClick={() => onOpen(row.id)}>Continuar <Icon name="arrow" /></button>
      </div>
    );
  }
  if (row.t === "next") {
    return (
      <button type="button" className={`${s.row} ${s.nx}`} {...common} onClick={() => onLocked(row.module ? "nextModule" : "lesson")}>
        <span className={s.nd} aria-hidden="true"><i /></span>
        <span className={s.ey}>{row.eyebrow || "Próximo"}</span>
        <span className={s.tt}>{row.title}</span>
        <span className={s.mt}>{row.meta}</span>
      </button>
    );
  }
  if (row.t === "locked") {
    return (
      <button type="button" className={`${s.row} ${s.lk}`} {...common} aria-label={`${row.title}, bloqueado, ${row.meta}`} onClick={() => onLocked("module")}>
        <span className={s.nd} aria-hidden="true"><Icon name="lock" /></span>
        <span className={s.tt}>{row.title}</span>
        <span className={s.mt}>{row.meta}</span>
      </button>
    );
  }
  // certificação (destino)
  if (row.available) {
    return (
      <button type="button" className={`${s.row} ${s.lk} ${s.ct} ${s.ctOn}`} {...common} onClick={onCert}>
        <span className={s.nd} aria-hidden="true"><Icon name="award" /></span>
        <span className={s.tt}>Certificação</span>
        <span className={s.mt}>Ver certificado</span>
      </button>
    );
  }
  return (
    <button type="button" className={`${s.row} ${s.lk} ${s.ct}`} {...common} aria-label={`Certificação, bloqueada: ${row.hint}`} onClick={() => onLocked("cert")}>
      <span className={s.nd} aria-hidden="true"><Icon name="award" /></span>
      <span className={s.tt}>Certificação</span>
      <span className={s.mt}>{row.hint}</span>
    </button>
  );
}
