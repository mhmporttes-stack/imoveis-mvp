"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Título de UMA linha que ocupa a largura do bloco onde está (pedido do dono, 2026-10-16: o título termina onde termina
 * a frase de baixo; e o título da seção "Por que comprar comigo" inteiro numa linha). Mede o texto no tamanho atual e
 * ajusta o `font-size` proporcionalmente, de novo quando o bloco muda de largura ou as fontes terminam de carregar.
 *  - `maxPx`: teto do tamanho (o título nunca passa disso, mesmo com espaço de sobra);
 *  - `minPx`: piso de legibilidade — se uma linha só exigir letra menor que isso (celular), o título volta a quebrar
 *    em mais linhas no tamanho mínimo, em vez de ficar minúsculo.
 * Sem JavaScript fica no tamanho do CSS, com quebra normal de linha.
 */
export default function FitLine({ as: Tag = "h1", className = "", style, minPx = 12, maxPx = 96, children, ...rest }) {
  const lineRef = useRef(null);
  const textRef = useRef(null);

  useLayoutEffect(() => {
    const line = lineRef.current;
    const text = textRef.current;
    if (!line || !text) return undefined;
    let lastWidth = -1;
    const fit = (force) => {
      if (force !== true && line.clientWidth === lastWidth) return; // só reajusta quando a LARGURA muda (evita laço do observer)
      line.style.fontSize = "";
      text.style.display = "inline-block";
      text.style.whiteSpace = "nowrap";
      const target = line.clientWidth;
      const measured = text.getBoundingClientRect().width;
      const current = Number.parseFloat(getComputedStyle(line).fontSize);
      if (!target || !measured || !current) return;
      const ideal = (current * target) / measured;
      if (ideal < minPx) {
        // não cabe em uma linha com letra legível: quebra normalmente no tamanho mínimo
        text.style.display = "";
        text.style.whiteSpace = "";
        line.style.fontSize = `${minPx}px`;
      } else {
        line.style.fontSize = `${Math.floor(Math.min(ideal, maxPx) * 100) / 100}px`;
      }
      lastWidth = target;
    };
    fit(true);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    observer?.observe(line);
    document.fonts?.ready?.then(() => fit(true)).catch(() => {});
    return () => observer?.disconnect();
  }, [minPx, maxPx]);

  return (
    <Tag ref={lineRef} className={className} style={style} {...rest}>
      <span ref={textRef}>{children}</span>
    </Tag>
  );
}
