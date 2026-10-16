"use client";

import { useEffect, useRef, useState } from "react";
import { arrowHead, scribblePoints, smoothPath } from "./scribble-path.mjs";

/**
 * Setas-rabisco da seção "Imóveis em Marília" (dono, 2026-10-17): duas linhas finas, na cor do título, que SE DESENHAM
 * sozinhas como um rabisco quando a seção aparece:
 *  1. sai da direita do "U" de "SEU" e termina acima do meio do botão "Região" (trajeto com um laço);
 *  2. sai da esquerda do "E" de "ENCONTRE" e termina acima do "ou" de "Bairro, nome ou diferencial" (arco suave).
 * As duas PARAM apontando para baixo, logo acima do cartão de pesquisa, sem entrar nele; o traço é liso (sem tremido).
 * Posições são MEDIDAS no navegador (letras do título, botão e texto do campo), então acompanham qualquer largura de tela.
 * Só no computador (md+): no celular os campos empilham e a seta não faria sentido. Com "reduzir movimento" ligado as
 * setas aparecem prontas. Decorativo (aria-hidden), nunca captura clique.
 */
const ARROWS = [
  // cada traço leva 3 s para se desenhar (dono, 2026-10-17: "muito rápida"); a segunda seta começa logo depois da primeira
  { id: "regiao", shape: "laco", delay: 0.2, duration: 3 },
  { id: "busca", shape: "onda", delay: 0.7, duration: 3 }
];

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
  const tipY = form.getBoundingClientRect().top - 7; // a ponta fica logo ACIMA do cartão de pesquisa
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

  return {
    width: box.width,
    height: box.height,
    arrows: {
      regiao: {
        from: rel(last.right + 10, last.top + last.height / 2),
        to: rel(regionRect.left + regionRect.width / 2, tipY)
      },
      busca: {
        from: rel(first.left - 10, first.top + first.height / 2),
        to: rel(inputRect.left + padding + before + ou / 2, tipY)
      }
    }
  };
}

export default function ScribbleArrows({ containerRef }) {
  const [layout, setLayout] = useState(null);
  const [go, setGo] = useState(false);
  const [reduced, setReduced] = useState(false);
  const pathRefs = useRef({});
  const [lengths, setLengths] = useState({});

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
          setLayout(null); // enfeite: qualquer falha de medição só some com as setas, nunca quebra a seção
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
      { threshold: 0.35 }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, go]);

  const built = layout
    ? ARROWS.map((arrow) => {
        const { from, to } = layout.arrows[arrow.id];
        const points = scribblePoints(from, to, arrow.shape);
        // ponta sempre apontando reto para baixo
        return { ...arrow, d: smoothPath(points), head: arrowHead({ x: to.x, y: to.y - 16 }, to) };
      })
    : [];

  // comprimento real de cada traço (para o desenho "à mão" por stroke-dashoffset)
  const signature = built.map((arrow) => arrow.d).join("|");
  useEffect(() => {
    const next = {};
    for (const arrow of built) {
      const el = pathRefs.current[arrow.id];
      if (el) next[arrow.id] = Math.ceil(el.getTotalLength());
    }
    setLengths(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  if (!layout) return null;
  const instant = reduced;
  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-[5] hidden overflow-visible md:block"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {built.map((arrow) => {
        const length = lengths[arrow.id];
        const ready = Boolean(length);
        const drawn = instant || go;
        const style = {
          fill: "none",
          stroke: "#0D3B66",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round"
        };
        return (
          <g key={arrow.id}>
            <path
              ref={(el) => { pathRefs.current[arrow.id] = el; }}
              d={arrow.d}
              style={{
                ...style,
                strokeDasharray: ready ? length : undefined,
                strokeDashoffset: ready ? (drawn ? 0 : length) : 0,
                opacity: ready ? 1 : 0,
                // a transição só existe a partir do disparo da cena (antes disso o traço já nasce "escondido", sem animar ao contrário)
                transition: instant || !go ? "none" : `stroke-dashoffset ${arrow.duration}s cubic-bezier(0.45, 0.05, 0.3, 1) ${arrow.delay}s`
              }}
            />
            <path
              d={arrow.head}
              style={{
                ...style,
                opacity: drawn ? 1 : 0,
                transition: instant || !go ? "none" : `opacity 0.25s ease ${arrow.delay + arrow.duration - 0.1}s`
              }}
            />
          </g>
        );
      })}
    </svg>
  );
}
