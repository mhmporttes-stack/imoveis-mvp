"use client";

import { useEffect, useRef } from "react";
import {
  HENRY_PULSE_CARD_W,
  HENRY_PULSE_DEFAULTS,
  HENRY_PULSE_PHASES,
  HENRY_PULSE_SWALLOW,
  HENRY_PULSE_TYPES,
  HENRY_PULSE_WIDE,
  groupPulseBursts,
  pickPulseSpot,
  pulseBeamCurve,
  pulseAvatar,
  pulseCardText,
  pulseEase,
  pulsePhase,
  pulsePullPosition,
  pulseBlobShape,
  pulseBlobStartAngle
} from "@/lib/henry-pulse-core.mjs";
import { isPageHidden, onPageVisibilityChange } from "@/components/page-visibility";
import { HENRY_ORB_HIT_MS } from "./henry-orb-states.mjs";
import { drawStrandBeam } from "./henry-strand-beam.mjs";

// "Pulso do CRM" (rascunho HENRY-1 "Pulso", [PENDENTE DE VALIDAÇÃO]; conceito aprovado pelo dono em 2026-10-23).
// Em volta do anel da tela cheia aparecem cards com eventos REAIS do CRM (GET /api/admin/henry/pulse): um feixe de 5 fios
// vibrantes sai do anel até um ponto nas laterais, contorna o card numa forma orgânica e ondulada (é a moldura dele), o
// card aparece dentro, fica parado e depois a linha o puxa de volta para dentro do Henry, que pulsa ao "engolir" (fica
// um rastro apagado no lugar). Ciclo e números: pulsePhase (lib/henry-pulse-core.mjs). Comportamento e parâmetros = protótipo aprovado (pulso-do-crm.html): config
// com os MESMOS nomes (rate, maxCards, life, cardOpacity, trailOpacity, beam, pulse, types) — para os valores
// finais do dono, troque só HENRY_PULSE_DEFAULTS (lib/henry-pulse-core.mjs).
// Computador (≥ 820 px ou mouse): cards só nas faixas laterais onde cabem inteiros fora da coluna do anel; celular: em
// volta (pode cruzar).
// Leve (i7 sem GPU): DOM imperativo (sem re-render por quadro), sem backdrop-filter, laço de desenho só enquanto há
// card/rastro/pulso, consulta a cada ~20 s só com a aba visível; aba oculta pausa tudo. prefers-reduced-motion: sem
// puxada nem vibração. Henry pensando/falando (dim): eventos mais apagados para não competir.
// Cards SÓ com o Henry parado (dono, 2026-10-23, protótipo v23): com idle falso nenhum card nasce (os eventos esperam na
// fila) e os que estão na tela pulam para a fase de voltar ao Henry (k = 0,7) e somem.
// O anel é o REAL (HenryOrb, montado pelo HenryVoiceView): o Pulso não desenha anel próprio; a chegada de um evento vai
// para o anel como "level" (levelRef = pulso × 0,6), somado ao sinal de voz pelo HenryVoiceView, e o trecho por onde o
// card entrou fica mais forte (hitsRef → signal.hits, desenhado pelo próprio HenryOrb nas cores dele).
// O feixe é desenhado aqui (não reaproveita o HenryOrb: lá os fios são radiais em volta de um círculo; aqui seguem uma
// curva entre dois pontos) com o mesmo estilo: fios finos, composição "lighter", glow.

const POLL_MS = 20 * 1000;
const POLL_OVERLAP_MS = 30 * 1000; // evento gravado com hora um pouco anterior à consulta não se perde (id repetido é ignorado)
const MAX_QUEUE = 12;
const TRAIL_MS = 9000;

async function fetchPulse(sinceIso) {
  const response = await fetch(`/api/admin/henry/pulse?since=${encodeURIComponent(sinceIso)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`pulso ${response.status}`);
  return response.json();
}

// Ícones dos canais e da simulação (protótipo v13; SVG fixo do código, nunca dado do servidor).
const PULSE_ICONS = {
  whatsapp: `<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#25D366"/><path fill="#fff" d="M16 7.2a8.8 8.8 0 0 0-7.6 13.2L7.2 24.8l4.5-1.2A8.8 8.8 0 1 0 16 7.2Zm0 16a7.2 7.2 0 0 1-3.7-1l-.3-.2-2.6.7.7-2.6-.2-.3A7.2 7.2 0 1 1 16 23.2Zm4-5.4c-.2-.1-1.3-.6-1.5-.7s-.3-.1-.5.1l-.7.9c-.1.1-.3.2-.5.1a5.9 5.9 0 0 1-2.9-2.6c-.2-.4.2-.4.6-1.2.1-.1 0-.3 0-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.4a.8.8 0 0 0-.6.3 2.5 2.5 0 0 0-.8 1.9 4.4 4.4 0 0 0 .9 2.3 10 10 0 0 0 3.8 3.4c1.4.6 2 .7 2.7.6a2.3 2.3 0 0 0 1.5-1.1 1.9 1.9 0 0 0 .1-1.1c0-.1-.2-.2-.5-.3Z"/></svg>`,
  messenger: `<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><defs><linearGradient id="hp-gm" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#0099FF"/><stop offset=".6" stop-color="#A033FF"/><stop offset="1" stop-color="#FF5280"/></linearGradient></defs><circle cx="16" cy="16" r="16" fill="url(#hp-gm)"/><path fill="#fff" d="M16 7c-5 0-9 3.7-9 8.7 0 2.6 1.1 4.9 2.9 6.5v3.1l2.8-1.5c1 .3 2.1.4 3.3.4 5 0 9-3.7 9-8.5S21 7 16 7Zm.9 11.4-2.3-2.4-4.4 2.4 4.9-5.2 2.3 2.4 4.4-2.4-4.9 5.2Z"/></svg>`,
  instagram: `<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><defs><radialGradient id="hp-gi" cx=".3" cy="1" r="1.2"><stop offset="0" stop-color="#FFD776"/><stop offset=".35" stop-color="#F3584C"/><stop offset=".7" stop-color="#C13584"/><stop offset="1" stop-color="#5B51D8"/></radialGradient></defs><rect width="32" height="32" rx="9" fill="url(#hp-gi)"/><rect x="8" y="8" width="16" height="16" rx="5" fill="none" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="3.8" fill="none" stroke="#fff" stroke-width="2"/><circle cx="21.2" cy="10.8" r="1.2" fill="#fff"/></svg>`,
  simulacao: `<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#0b3d91"/><path fill="none" stroke="#5cd6ff" stroke-width="1.8" stroke-linejoin="round" d="M9 15.5 16 9.5l7 6V23H9Z"/><path fill="#5cd6ff" d="M12.5 17.5h2v2h-2zM17.5 17.5h2v2h-2z"/></svg>`
};

// Avatar (pulseAvatar): ícone do canal, foto real do corretor com anel na cor dele, ou inicial no círculo dessa cor.
function buildAvatar(event) {
  const avatar = pulseAvatar(event);
  if (avatar.kind === "icon") {
    const el = document.createElement("span");
    el.className = "hp-av hp-icon";
    el.innerHTML = PULSE_ICONS[avatar.icon];
    return el;
  }
  if (avatar.kind === "photo") {
    const img = document.createElement("img");
    img.className = "hp-av";
    img.src = avatar.url;
    img.alt = "";
    img.draggable = false;
    img.style.boxShadow = `0 0 0 1.5px ${avatar.color}`;
    img.addEventListener("error", () => img.replaceWith(initialAvatar(pulseAvatar({ ...event, broker: { ...event.broker, photo: "" } }))), { once: true });
    return img;
  }
  return initialAvatar(avatar);
}
function initialAvatar(avatar) {
  const el = document.createElement("span");
  el.className = "hp-av";
  el.textContent = avatar.letter;
  el.style.background = avatar.color;
  return el;
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const beamColor = (cfg, event) => (cfg.beam === "gold" ? "#e9c27a" : cfg.beam === "cyan" ? "#5cd6ff" : HENRY_PULSE_TYPES[event.type]?.color || "#5cd6ff");

export default function HenryPulse({ active = false, config = HENRY_PULSE_DEFAULTS, orbSize = 520, mobile = false, dim = false, poll = fetchPulse, onOpen = null, pollMs = POLL_MS, levelRef = null, hitsRef = null, busyRef = null, idle = true }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const cfgRef = useRef(config);
  const dimRef = useRef(dim);
  const geoRef = useRef({ orbSize, mobile });
  const openRef = useRef(onOpen);
  const pollRef = useRef(poll);
  cfgRef.current = { ...HENRY_PULSE_DEFAULTS, ...config };
  dimRef.current = dim;
  const idleRef = useRef(idle);
  idleRef.current = idle;
  geoRef.current = { orbSize, mobile };
  openRef.current = onOpen;
  pollRef.current = poll;

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!active || !root || !canvas) return undefined;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(pointer: fine)").matches; // computador com mouse: nunca por cima do Henry
    const live = []; // { el, x, y, born, event, bend, w, h }
    const trails = [];
    const queue = [];
    const seen = new Set();
    let W = 0;
    let H = 0;
    let ringPulse = 0;
    let raf = 0;
    let nextAt = 0;
    let since = new Date(Date.now() - 60 * 1000).toISOString();
    let pollTimer = 0;
    let alive = true;

    const geometry = () => {
      const { orbSize: size, mobile: phone } = geoRef.current;
      // Mesmo centro do anel no HenryVoiceView (celular: anel 14vh acima do meio); raio ≈ fios do HenryOrb (0,3 × tamanho).
      return { cx: W / 2, cy: H / 2 - (phone ? H * 0.14 : 0), R: size * 0.32 };
    };
    const resize = () => {
      const rect = root.getBoundingClientRect();
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      W = rect.width;
      H = rect.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      kick();
    };
    const dimFactor = () => (dimRef.current ? 0.45 : 1);

    function spawn(event) {
      const cfg = cfgRef.current;
      if (!cfg.types.includes(event.type)) return;
      if (live.length >= cfg.maxCards) {
        const oldest = live.reduce((a, b) => (a.born < b.born ? a : b));
        oldest.born -= cfg.life * 1000; // o mais antigo termina na hora (vira rastro)
      }
      const { cx, cy, R } = geometry();
      const cardW = Math.min(HENRY_PULSE_CARD_W, W - 24);
      // Computador: a conversa fica no canto inferior direito — os cards param ~240 px acima do rodapé para não cobri-la.
      const wide = W >= HENRY_PULSE_WIDE || finePointer;
      const { x, y } = pickPulseSpot({ W, H, cx, cy, R, live, cardW, wide, bottomSafe: wide ? 240 : 120 });
      const type = HENRY_PULSE_TYPES[event.type] || HENRY_PULSE_TYPES.whatsapp;
      const text = pulseCardText(event);
      const el = document.createElement("button");
      el.type = "button";
      el.className = "hp-card";
      el.setAttribute("aria-label", `${type.label}: ${text.who}. ${text.what}`);
      const avatar = buildAvatar(event);
      const box = document.createElement("span");
      box.className = "hp-tx";
      const tag = document.createElement("span");
      tag.className = "hp-tag";
      tag.style.color = type.color;
      tag.textContent = text.tag;
      const who = document.createElement("span");
      who.className = "hp-who";
      who.textContent = text.who;
      const what = document.createElement("span");
      what.className = "hp-what";
      what.textContent = text.what;
      box.append(tag, who, what);
      el.append(avatar, box);
      el.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        if (event.link?.path) openRef.current?.(event.link, event);
      });
      el.style.opacity = "0";
      root.appendChild(el);
      live.push({ el, x, y, born: performance.now(), event, text, bend: (Math.random() < 0.5 ? -1 : 1) * (0.22 + Math.random() * 0.18), w: el.offsetWidth, h: el.offsetHeight });
      ringPulse = Math.min(1, ringPulse + cfg.pulse);
      kick();
    }

    function addTrail(text, x, y) {
      const el = document.createElement("span");
      el.className = "hp-trail";
      el.textContent = `${text} · agora`;
      el.style.top = `${y}px`;
      root.prepend(el);
      el.style.left = `${clamp(x, 12, W - el.offsetWidth - 12)}px`; // rastro inteiro na tela (medido, não estimado)
      trails.push({ el, born: performance.now() });
    }

    function drawBeam(card, t, phase, pos) {
      const bk = phase.beam;
      const scale = phase.scale;
      const cfg = cfgRef.current;
      const color = beamColor(cfg, card.event);
      const { cx, cy, R } = geometry();
      // Chegada = ponto da moldura orgânica (em volta do card, medida real do card com a escala e a posição de agora)
      // voltado para o anel — acompanha a puxada.
      const cw = card.w * scale;
      const ch = card.h * scale;
      const blob = pulseBlobShape({ left: pos.x + (card.w - cw) / 2, top: pos.y + (card.h - ch) / 2, width: cw, height: ch, born: card.born, t, reduced });
      const th0 = pulseBlobStartAngle(blob, cx, cy);
      const [tx, ty] = blob.point(th0);
      const d = dimFactor();
      if (phase.rect !== null && phase.frame > 0) {
        // Moldura (protótipo v8): do ponto de toque a linha vibrante corre pela forma orgânica nos dois sentidos até fechar
        // e FICA enquanto o card sobe; no topo se desenrola de volta. 3 fios (o do meio branco) e uma gotinha branca
        // na ponta de cada lado enquanto corre.
        const along = (dist) => blob.point(th0 + (dist / blob.perimeter) * Math.PI * 2);
        const reach = (pulseEase(phase.rect) * blob.perimeter) / 2;
        // Fundo escuro só por dentro da moldura ondulada (atrás das linhas e do texto; o card não tem fundo — v9).
        const fill = new Path2D();
        for (let i = 0; i <= 72; i += 1) {
          const [fx, fy] = blob.point(th0 + (i / 72) * Math.PI * 2);
          if (i) fill.lineTo(fx, fy);
          else fill.moveTo(fx, fy);
        }
        fill.closePath();
        ctx.save();
        ctx.globalAlpha = 0.62 * pulseEase(Math.min(1, phase.rect)) * phase.frame * d;
        ctx.fillStyle = "#06101f";
        ctx.fill(fill);
        ctx.restore();
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (const dir of [1, -1]) {
          for (let s = 0; s < 3; s += 1) {
            const off = s - 1;
            ctx.beginPath();
            for (let u = 0; u <= reach + 0.5; u += 4) {
              const [px, py] = along(dir * Math.min(u, reach));
              const j = reduced ? 0 : Math.sin(u * 0.09 + t * 0.02 + s * 1.9) * 1.4;
              const rl = Math.hypot(px - blob.mx, py - blob.my) || 1; // vibração pela normal radial a partir do centro do card
              const x = px + ((off * 1.2 + j) * (px - blob.mx)) / rl;
              const y = py + ((off * 1.2 + j) * (py - blob.my)) / rl;
              if (u === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = s === 1 ? "#ffffff" : color;
            if (s === 1) {
              // Brilho da moldura sem shadowBlur (caro sem GPU): o fio do meio largo e quase transparente, na cor do tipo.
              ctx.strokeStyle = color;
              ctx.globalAlpha = 0.2 * phase.frame * d;
              ctx.lineWidth = 5;
              ctx.stroke();
              ctx.strokeStyle = "#ffffff";
            }
            ctx.globalAlpha = (s === 1 ? 0.75 : 0.5) * phase.frame * d;
            ctx.lineWidth = s === 1 ? 1.2 : 0.8;
            ctx.stroke();
          }
          if (phase.rect < 1) {
            const [hx, hy] = along(dir * reach);
            ctx.globalAlpha = d;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(hx, hy, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
      const angle = Math.atan2(ty - cy, tx - cx);
      const sx = cx + Math.cos(angle) * R;
      const sy = cy + Math.sin(angle) * R;
      const bez = pulseBeamCurve({ sx, sy, tx, ty, bend: card.bend, wobble: reduced ? 0 : Math.sin(t * 0.003 + card.born) * 0.04 });
      // Feixe padrão (5 fios, gradiente, gotinhas): o mesmo desenho das linhas das cenas (HenryStrandBeam).
      drawStrandBeam(ctx, { point: bez, sx, sy, reach: bk, color, t, seed: card.born * 0.001, reduced, dim: d });
    }

    function frame(t) {
      raf = 0;
      if (!alive || isPageHidden()) return;
      const cfg = cfgRef.current;
      ctx.clearRect(0, 0, W, H);
      ringPulse *= 0.94;
      if (levelRef) levelRef.current = ringPulse * 0.6; // chegada de evento = "level" do anel REAL (HenryOrb)
      const life = cfg.life * 1000;
      for (let i = live.length - 1; i >= 0; i -= 1) {
        const card = live[i];
        const k = (t - card.born) / life;
        if (k >= 1) {
          addTrail(card.text.trail, card.x, card.y + 10);
          ringPulse = Math.min(1, ringPulse + cfg.pulse * HENRY_PULSE_SWALLOW); // o Henry "engole" o card
          if (hitsRef) {
            // Pulso no trecho do anel por onde o card entrou, nas cores do próprio Henry (desenhado pelo HenryOrb, v21).
            const { cx, cy } = geometry();
            const hits = (hitsRef.current || []).filter((hit) => t - hit.born < HENRY_ORB_HIT_MS);
            hits.push({ ang: Math.atan2(card.y + card.h / 2 - cy, card.x + card.w / 2 - cx), born: t });
            hitsRef.current = hits;
          }
          card.el.remove();
          live.splice(i, 1);
          continue;
        }
        // Henry saiu do parado (protótipo v23): o card pula direto para a fase de voltar ao Henry e some.
        if (!idleRef.current && k < HENRY_PULSE_PHASES.pull) {
          card.born = t - HENRY_PULSE_PHASES.pull * life;
          i += 1; // reprocessa este card já na fase nova
          continue;
        }
        // Ciclo v10 (pulsePhase): linha sai → moldura e card → parado → a linha puxa o card de volta para dentro do Henry.
        const phase = pulsePhase(k, { reduced });
        const pos = pulsePullPosition(card, geometry(), phase.pull);
        card.el.style.opacity = (cfg.cardOpacity * phase.appear * phase.fadeOut * dimFactor()).toFixed(3);
        card.el.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${phase.scale})`;
        card.el.style.pointerEvents = phase.appear > 0.5 && phase.pull < 0.3 ? "auto" : "none";
        if (phase.beam > 0.001) drawBeam(card, t, phase, pos);
      }
      for (let i = trails.length - 1; i >= 0; i -= 1) {
        const trail = trails[i];
        const k = (t - trail.born) / TRAIL_MS;
        if (k >= 1) {
          trail.el.remove();
          trails.splice(i, 1);
          continue;
        }
        trail.el.style.opacity = (cfg.trailOpacity * (1 - k) * dimFactor()).toFixed(3);
        trail.el.style.transform = `translateY(${reduced ? 0 : -k * 40}px)`;
      }
      if (busyRef) busyRef.current = live.length > 0;
      if (live.length || trails.length || ringPulse >= 0.02) raf = requestAnimationFrame(frame);
      else {
        ctx.clearRect(0, 0, W, H);
        if (levelRef) levelRef.current = 0;
      }
    }
    function kick() {
      if (!raf && alive && !isPageHidden()) raf = requestAnimationFrame(frame);
    }

    // Agendador: no máximo `rate` por minuto, um de cada vez, na ordem em que chegaram.
    const scheduler = window.setInterval(() => {
      if (isPageHidden() || !queue.length || !idleRef.current) return; // card novo só com o Henry parado (v23)
      const now = performance.now();
      if (now < nextAt) return;
      spawn(queue.shift());
      nextAt = now + (60000 / Math.max(1, cfgRef.current.rate)) * (0.5 + Math.random());
    }, 200);

    async function load() {
      window.clearTimeout(pollTimer);
      if (!alive) return;
      if (!isPageHidden()) {
        try {
          const data = await pollRef.current(since);
          if (!alive) return;
          if (data?.now) since = new Date(Date.parse(data.now) - POLL_OVERLAP_MS).toISOString();
          const fresh = (Array.isArray(data?.events) ? data.events : []).filter((event) => event?.id && !seen.has(event.id) && cfgRef.current.types.includes(event.type));
          fresh.forEach((event) => seen.add(event.id));
          if (seen.size > 2000) seen.clear();
          if (fresh.length) {
            queue.push(...groupPulseBursts(fresh));
            if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE); // atrasou demais: fica o mais recente
          }
        } catch {
          // Sem rede/servidor: o Pulso só fica parado; a próxima consulta tenta de novo (o erro já está no log do servidor).
        }
      }
      if (alive) pollTimer = window.setTimeout(load, pollMs);
    }
    const onVisibility = () => {
      if (isPageHidden()) return;
      nextAt = 0;
      kick();
      load();
    };

    resize();
    load();
    window.addEventListener("resize", resize);
    const stopVisibility = onPageVisibilityChange(onVisibility); // aba oculta ou app de desktop minimizado
    return () => {
      alive = false;
      window.clearInterval(scheduler);
      window.clearTimeout(pollTimer);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      stopVisibility();
      [...live, ...trails].forEach((item) => item.el.remove());
      if (levelRef) levelRef.current = 0;
      if (hitsRef) hitsRef.current = [];
      if (busyRef) busyRef.current = false;
    };
  }, [active, pollMs, levelRef, hitsRef, busyRef]);

  if (!active) return null;
  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-label="Pulso do CRM" role="log" data-henry-pulse>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <style>{PULSE_CSS}</style>
    </div>
  );
}

// Visual do protótipo v7 (card sem borda fixa: a moldura é a linha vibrante do canvas); sem o backdrop-filter do protótipo
// (custo alto sem GPU). v9: sem fundo — o escurecimento é desenhado no canvas, só dentro da moldura ondulada.
const PULSE_CSS = `
[data-henry-pulse] .hp-card{position:absolute;left:0;top:0;display:flex;align-items:center;gap:10px;padding:9px 12px 9px 9px;max-width:min(270px,calc(100vw - 24px));border-radius:14px;text-align:left;color:#e8f0ff;cursor:pointer;background:none;border:1px solid transparent;box-shadow:none;text-shadow:0 1px 6px rgba(2,8,20,.9);transform-origin:center;will-change:transform,opacity}
[data-henry-pulse] .hp-card:focus-visible{outline:2px solid #e9c27a;outline-offset:2px}
[data-henry-pulse] .hp-av{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:13px;color:#06101f;object-fit:cover}
[data-henry-pulse] .hp-icon{border-radius:0;background:none}
[data-henry-pulse] .hp-icon svg{display:block}
[data-henry-pulse] .hp-tx{display:flex;flex-direction:column;min-width:0}
[data-henry-pulse] .hp-tag{font-family:ui-monospace,Consolas,monospace;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;margin-bottom:2px}
[data-henry-pulse] .hp-who{font-size:12.5px;font-weight:700;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-henry-pulse] .hp-what{font-size:11.5px;color:#8fa3c7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-henry-pulse] .hp-trail{position:absolute;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#8fa3c7;white-space:nowrap;pointer-events:none;will-change:opacity,transform}
`;
