"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Cena de entrada da seção "Imóveis em Marília" (dono, 2026-10-17), modelo "Opção 2 ajustada", que SE DESENHA sozinha
 * quando a seção aparece:
 *  1. duas linhas finas saem das pontas do título ("U" de SEU e "E" de ENCONTRE), correm para o lado, descem e terminam
 *     em uma setinha: a da direita acima do meio do botão "Região", a da esquerda acima do "ou" de "Bairro, nome ou diferencial";
 *  2. depois o contorno do filtro nasce no MEIO da borda de cima, corre para os dois lados e os dois traços se encontram
 *     no MEIO da borda de baixo; ele fica suave (opacidade reduzida);
 *  3. quando fecha, o filtro dá o mesmo efeito de passar o mouse (sobe um pouco, ganha sombra e borda azulada) e volta.
 * Posições são MEDIDAS no navegador (letras do título, botão, texto do campo e o próprio filtro), então acompanham qualquer
 * largura de tela. O contorno vive DENTRO do filtro (portal), por isso acompanha o efeito de subir. No celular/tablet estreito
 * os campos empilham (Região fica abaixo da busca): aí as duas linhas descem retas das pontas do título (E e U) até logo acima do
 * filtro, com a setinha, e o resto da cena é igual. Com "reduzir movimento" tudo aparece pronto. Decorativo (aria-hidden).
 */
const COLOR = "#1769D1";
const HIDDEN = 1.02; // dashoffset que deixa o traço (pathLength=1) totalmente escondido, sem pingo na ponta redonda
const DASH = "1 2";
const EASE = "cubic-bezier(0.4, 0, 0.25, 1)";
const EASE_OUTLINE = "cubic-bezier(0.45, 0, 0.55, 1)";
const OUTLINE_RADIUS = 20;
const TIP_GAP = 6; // a ponta da setinha para logo acima do filtro

// tempos (s) da cena
const T = {
  right: { delay: 0.2, duration: 1.6 },
  rightHead: { delay: 1.8, duration: 0.35 },
  left: { delay: 0.5, duration: 1.6 },
  leftHead: { delay: 2.1, duration: 0.35 },
  outline: { delay: 2.5, duration: 2.6 },
  fade: { duration: 1.6 },
  hover: { duration: 1.3 }
};

function characterRect(root, index) {
  // retângulo da letra `index` (negativo = contando do fim) do primeiro texto do elemento
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !node.textContent.trim()) node = walker.nextNode();
  if (!node) return null;
  const raw = node.textContent;
  const start = raw.length - raw.trimStart().length;
  const end = raw.trimEnd().length;
  const at = index < 0 ? end + index : start + index;
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + 1);
  return range.getBoundingClientRect();
}

function measure(container) {
  const box = container.getBoundingClientRect();
  const form = container.querySelector('form[role="search"]');
  const title = container.querySelector("#imoveis-title");
  if (!form || !title || !box.width) return null;
  const rel = (x, y) => ({ x: x - box.left, y: y - box.top });
  const first = characterRect(title, 0);
  const last = characterRect(title, -1);
  const region = form.querySelectorAll("select")[1];
  const input = form.querySelector('input[type="search"]');
  if (!first || !last || !region || !input) return null;

  const regionRect = region.getBoundingClientRect();
  const tipY = form.getBoundingClientRect().top - box.top - TIP_GAP;
  const inputRect = input.getBoundingClientRect();
  const style = getComputedStyle(input);
  const placeholder = getComputedStyle(input, "::placeholder");
  const canvas = document.createElement("canvas").getContext("2d");
  canvas.font = `${placeholder.fontStyle || "normal"} ${placeholder.fontWeight || "500"} ${style.fontSize} ${style.fontFamily}`;
  const text = input.getAttribute("placeholder") || "";
  const at = text.indexOf(" ou ");
  if (at < 0) return null;
  const before = canvas.measureText(text.slice(0, at + 1)).width;
  const ou = canvas.measureText("ou").width;
  const padding = Number.parseFloat(style.paddingLeft) || 0;

  // campos empilhados (celular): Região fica ABAIXO da busca
  const stacked = regionRect.top > inputRect.bottom - 2;
  const rightFrom = stacked ? rel(last.right - 8, last.bottom + 3) : rel(last.right + 10, last.top + last.height / 2);
  const leftFrom = stacked ? rel(first.left + 8, first.bottom + 3) : rel(first.left - 10, first.top + first.height / 2);
  const rightX = stacked ? rightFrom.x : regionRect.left - box.left + regionRect.width / 2;
  const leftX = stacked ? leftFrom.x : inputRect.left - box.left + padding + before + ou / 2;
  return {
    width: box.width,
    height: box.height,
    form: { width: form.offsetWidth, height: form.offsetHeight, element: form },
    tipY,
    // cada seta só existe se o alvo estiver do lado certo do título (em telas estreitas pode não haver espaço)
    right: stacked || rightX - rightFrom.x >= 16 ? { from: rightFrom, x: rightX } : null,
    left: stacked || leftFrom.x - leftX >= 16 ? { from: leftFrom, x: leftX } : null
  };
}

/** Linha que sai do título, corre de lado, faz uma curva suave e desce até a setinha. */
function elbow(from, x, tipY) {
  const dir = x > from.x ? 1 : -1;
  const endY = tipY - 8;
  const r = Math.max(0, Math.min(24, Math.abs(x - from.x) / 2, (endY - from.y) / 2));
  const f = (n) => Math.round(n * 10) / 10;
  const body = r < 1
    ? `M${f(x)} ${f(from.y)} V${f(endY)}`
    : `M${f(from.x)} ${f(from.y)} H${f(x - dir * r)} Q${f(x)} ${f(from.y)} ${f(x)} ${f(from.y + r)} V${f(endY)}`;
  const head = `M${f(x - 7)} ${f(endY)} L${f(x)} ${f(tipY)} L${f(x + 7)} ${f(endY)}`;
  return { body, head };
}

/** Contorno do filtro: dois traços que partem do meio da borda de cima e se encontram no meio da borda de baixo. */
function outlinePaths(w, h) {
  const r = Math.min(OUTLINE_RADIUS, h / 2, w / 4);
  const m = w / 2;
  const f = (n) => Math.round(n * 10) / 10;
  return {
    right: `M${f(m)} 0 H${f(w - r)} Q${f(w)} 0 ${f(w)} ${f(r)} V${f(h - r)} Q${f(w)} ${f(h)} ${f(w - r)} ${f(h)} H${f(m)}`,
    left: `M${f(m)} 0 H${f(r)} Q0 0 0 ${f(r)} V${f(h - r)} Q0 ${f(h)} ${f(r)} ${f(h)} H${f(m)}`
  };
}

export default function ScribbleArrows({ containerRef }) {
  const [layout, setLayout] = useState(null);
  const [go, setGo] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [played, setPlayed] = useState(false);
  const pathRefs = useRef({});

  // medição (e remedição quando a largura/altura muda ou as fontes terminam de carregar)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    setReduced(Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          setLayout(measure(container));
        } catch {
          setLayout(null); // enfeite: qualquer falha de medição só some com a cena, nunca quebra a seção
        }
      });
    };
    run();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(run) : null;
    observer?.observe(container);
    window.addEventListener("resize", run);
    document.fonts?.ready?.then(run).catch(() => {});
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", run);
    };
  }, [containerRef]);

  // dispara a cena quando a seção aparece (uma vez)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || go) return undefined;
    if (typeof IntersectionObserver !== "function") {
      setGo(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setGo(true);
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    // observa o FILTRO (não o bloco todo): no celular o bloco inclui a lista inteira de imóveis, tão alta que 35% dela nunca aparece
    observer.observe(container.querySelector('form[role="search"]') || container);
    return () => observer.disconnect();
  }, [containerRef, go]);

  // A CENA: todo traço nasce ESCONDIDO e, só quando ela dispara, é desenhado de forma contínua (Web Animations API). Depois
  // do contorno, o filtro dá o efeito de "mouse em cima".
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const ready = Boolean(layout);
  useEffect(() => {
    if (!go || !ready || played || reduced) return undefined;
    // dois quadros com o traço já escondido antes de começar (garante que nunca aparece pronto)
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      const draw = (id, { delay, duration }, easing = EASE) => {
        const el = pathRefs.current[id];
        if (!el || typeof el.animate !== "function") return;
        el.animate([{ strokeDashoffset: HIDDEN }, { strokeDashoffset: 0 }], { duration: duration * 1000, delay: delay * 1000, easing, fill: "both" });
      };
      draw("right:body", T.right);
      draw("right:head", T.rightHead, "linear");
      draw("left:body", T.left);
      draw("left:head", T.leftHead, "linear");
      const outlineEnd = T.outline.delay + T.outline.duration;
      for (const id of ["outline:right", "outline:left"]) {
        draw(id, T.outline, EASE_OUTLINE);
        pathRefs.current[id]?.animate?.([{ opacity: 1 }, { opacity: 0.4 }], { duration: T.fade.duration * 1000, delay: outlineEnd * 1000 + 1200, easing: "ease", fill: "both" });
      }
      // efeito de passar o mouse no filtro, assim que o contorno fecha
      const form = layoutRef.current?.form?.element;
      if (form && typeof form.animate === "function") {
        const line = getComputedStyle(form).borderColor;
        form.animate(
          [
            { transform: "none", boxShadow: "0 0 0 rgba(13,59,102,0)", borderColor: line, offset: 0 },
            { transform: "translateY(-3px)", boxShadow: "0 12px 28px rgba(13,59,102,0.16)", borderColor: "#9DC1EE", offset: 0.4 },
            { transform: "none", boxShadow: "0 0 0 rgba(13,59,102,0)", borderColor: line, offset: 1 }
          ],
          { duration: T.hover.duration * 1000, delay: outlineEnd * 1000 + 50, easing: "ease-in-out" }
        );
      }
      setPlayed(true);
    }));
    return () => cancelAnimationFrame(frame);
  }, [go, ready, played, reduced]);

  if (!layout) return null;
  const show = reduced || played; // estado final (reduzir movimento, ou depois de a cena ter rodado)
  const stroke = (width) => ({
    fill: "none",
    stroke: COLOR,
    strokeWidth: width,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeDasharray: DASH,
    strokeDashoffset: show ? 0 : HIDDEN
  });
  const arrows = [
    ["right", layout.right],
    ["left", layout.left]
  ].filter(([, value]) => value);
  const paths = outlinePaths(layout.form.width, layout.form.height);
  const outline = (
    <svg
      className="pointer-events-none absolute overflow-visible"
      style={{ left: -1, top: -1 }}
      width={layout.form.width}
      height={layout.form.height}
      viewBox={`0 0 ${layout.form.width} ${layout.form.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {["right", "left"].map((side) => (
        <path
          key={side}
          ref={(el) => { pathRefs.current[`outline:${side}`] = el; }}
          d={paths[side]}
          pathLength={1}
          style={{ ...stroke(2), opacity: show ? 0.4 : 1 }}
        />
      ))}
    </svg>
  );

  return (
    <>
      <svg
        className="pointer-events-none absolute left-0 top-0 z-[5] overflow-visible"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        aria-hidden="true"
        focusable="false"
      >
        {arrows.map(([id, value]) => {
          const { body, head } = elbow(value.from, value.x, layout.tipY);
          return (
            <g key={id}>
              <path ref={(el) => { pathRefs.current[`${id}:body`] = el; }} d={body} pathLength={1} style={stroke(1.6)} />
              <path ref={(el) => { pathRefs.current[`${id}:head`] = el; }} d={head} pathLength={1} style={stroke(1.6)} />
            </g>
          );
        })}
      </svg>
      {createPortal(outline, layout.form.element)}
    </>
  );
}
