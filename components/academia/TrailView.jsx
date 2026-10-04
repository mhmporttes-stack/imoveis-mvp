"use client";

// Trilha: UM caminho. Concluídos colapsados, Agora grande, Próximo, bloqueados com cadeado e a
// Certificação como destino. A linha sob o olhar define o andar da câmera (âncoras medidas aqui).
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import s from "./academia.module.css";
import TrailRow from "./TrailRow";

const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

// monta as linhas a partir do snapshot (nenhuma regra nova: estados e textos de bloqueio vêm dos dados)
export function buildRows(trail, flat) {
  const rows = [];
  const mods = trail.modules;
  const idxOf = (id) => flat.findIndex((l) => l.id === id);
  const cur = trail.current ? flat[idxOf(trail.current.id)] : null;
  for (const m of mods) {
    const ix = m.lessons.map((l) => l.id).map(idxOf).filter((i) => flat[i].state === "done");
    if (ix.length) rows.push({ t: "done", m: m.n, ix, total: m.lessonsTotal, part: ix.length < m.lessonsTotal, fl: (ix[0] + ix[ix.length - 1] + 1) / 2, lessons: ix.map((i) => flat[i]) });
  }
  if (cur) {
    const mod = mods.find((m) => m.n === cur.m);
    const inMod = flat.filter((l) => l.m === cur.m);
    rows.push({ t: "now", id: cur.id, m: cur.m, title: cur.title, minutes: cur.minutes, label: trail.current.label, fl: cur.idx + 0.5 });
    const nx = flat[cur.idx + 1];
    let from = cur.idx + 1;
    if (nx && nx.m === cur.m) {
      rows.push({ t: "next", title: nx.title, meta: `${nx.minutes} min`, fl: nx.idx + 0.5 });
      from = cur.idx + 2;
      const more = flat.filter((l) => l.idx >= from && l.m === cur.m);
      if (more.length) rows.push({ t: "locked", title: `Módulo ${cur.m}`, meta: `mais ${plural(more.length, "aula", "aulas")}`, fl: (more[0].idx + more[more.length - 1].idx + 1) / 2 });
    } else if (nx) {
      const nm = mods.find((m) => m.n === nx.m);
      const all = flat.filter((l) => l.m === nx.m);
      rows.push({ t: "next", module: true, eyebrow: `Próximo · Módulo ${nm.n}`, title: nm.title, meta: `${plural(all.length, "aula", "aulas")}${nm.lockHint ? " · " + nm.lockHint : ""}`, fl: (all[0].idx + all[all.length - 1].idx + 1) / 2 });
      from = all[all.length - 1].idx + 1;
    }
    void mod; void inMod;
    for (const m of mods) {
      const ix = flat.filter((l) => l.idx >= from && l.m === m.n);
      if (!ix.length) continue;
      const last = m.n === mods[mods.length - 1].n && ix.length === 1 && m.lessonsTotal === 1;
      rows.push({ t: "locked", title: last ? m.title : `Módulo ${m.n}`, meta: plural(ix.length, "aula", "aulas"), fl: (ix[0].idx + ix[ix.length - 1].idx + 1) / 2 });
    }
  }
  rows.push({ t: "cert", available: trail.certification.state === "available", hint: trail.certification.hint, fl: flat.length + 1.3 });
  return rows;
}

export default function TrailView({ engine, trail, flat, expanded, active, reduced, onToggle, onOpen, onLocked, onCert }) {
  const root = useRef(null);
  const path = useRef(null);
  const rows = useMemo(() => buildRows(trail, flat), [trail, flat]);

  const layout = useCallback(() => {
    const tr = root.current;
    if (!tr) return;
    const box = tr.getBoundingClientRect();
    const els = Array.from(tr.querySelectorAll(`.${s.row}, .${s.sub}`));
    const ys = [], fls = [], pts = [];
    els.forEach((r) => {
      const b = r.getBoundingClientRect();
      ys.push(b.top - box.top + b.height / 2);
      fls.push(parseFloat(r.dataset.fl));
      if (r.classList.contains(s.row)) {
        const nd = r.querySelector(`.${s.nd}`).getBoundingClientRect();
        pts.push({ x: nd.left - box.left + nd.width / 2, y: nd.top - box.top + nd.height / 2, cur: r.classList.contains(s.cur), lock: r.classList.contains(s.lk) || r.classList.contains(s.nx) });
      }
    });
    for (let i = 1; i < ys.length; i++) if (ys[i] <= ys[i - 1]) ys[i] = ys[i - 1] + 1;
    engine.setAnchors(ys, fls);
    const svg = path.current;
    if (!svg) return;
    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    let solid = "", dash = "";
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], my = (a.y + b.y) / 2;
      const seg = `M${a.x} ${a.y}C${a.x} ${my} ${b.x} ${my} ${b.x} ${b.y}`;
      if (b.lock) dash += seg; else solid += seg;
    }
    svg.innerHTML = `<path d="${dash}" fill="none" stroke="#6F86A6" stroke-width="3.5" stroke-dasharray="1 10" stroke-linecap="round"/><path d="${solid}" fill="none" stroke="#2A5DA3" stroke-width="5" stroke-linecap="round"/>`;
  }, [engine]);

  useLayoutEffect(() => {
    engine.cb.layoutTrail = layout;
    layout();
    return () => { if (engine.cb.layoutTrail === layout) engine.cb.layoutTrail = null; };
  }, [engine, layout, rows, expanded]);

  // entrada: linhas chegam da direita com 55 ms de defasagem (≤ 6), sem animação em movimento reduzido
  const was = useRef(false);
  useLayoutEffect(() => {
    if (active && !was.current && !reduced && root.current) {
      const els = Array.from(root.current.querySelectorAll(`.${s.row}`));
      els.forEach((r, i) => { r.classList.add(s.pre); r.style.transitionDelay = Math.min(i, 6) * 55 + "ms"; });
      const id = requestAnimationFrame(() => requestAnimationFrame(() => {
        els.forEach((r) => r.classList.remove(s.pre));
        setTimeout(() => els.forEach((r) => { r.style.transitionDelay = ""; }), 900);
      }));
      was.current = true;
      return () => cancelAnimationFrame(id);
    }
    was.current = active;
    return undefined;
  }, [active, reduced]);

  return (
    <div className={s.sc + (active ? " " + s.on : "")} ref={engine.refSc("trilha")} inert={!active} tabIndex={active ? 0 : -1} role="region" aria-label="Trilha de aulas">
      <div className={s.tr} ref={root} data-trail="1">
        <svg className={s.trpath} ref={path} aria-hidden="true" />
        {rows.map((r, i) => (
          <TrailRow key={r.t + i + (r.m || "") + (r.id || "")} row={r} open={r.t === "done" && expanded.has(r.m)} onToggle={onToggle} onOpen={onOpen} onLocked={onLocked} onCert={onCert} />
        ))}
      </div>
    </div>
  );
}
