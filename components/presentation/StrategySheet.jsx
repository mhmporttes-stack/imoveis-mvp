"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, MessageCircle, X } from "lucide-react";
import { formatBRL } from "@/lib/simulation-presentation-format.mjs";
import { formatInterestRateLabel } from "@/lib/interest-rate.mjs";
import { formatCurrencyInput, wholeReaisFromCurrencyInput } from "@/lib/property-filter-options";
import {
  STRATEGY_MAX_AMOUNT,
  STRATEGY_NAME,
  compareStrategy,
  emptyChoices,
  formatDuration,
  automaticOptionValue,
  choicesForRequest,
  choicesFromSaved,
  hasActiveExtras,
  isOptionAllowed,
  restrictChoices,
  strategyHeadline
} from "@/lib/payment-strategy-core.mjs";
import StrategyBalanceChart from "./StrategyBalanceChart";
import styles from "./presentation.module.css";

// Folha "Estratégia de pagamento" (PRES-24). Abre com os números da simulação (`strategy` = base do DTO, nunca redigitada) e
// deixa o cliente — ou o corretor, na prévia do CRM — ligar 13º e FGTS (AUTOMÁTICOS: valor calculado no servidor pela renda
// CLT do cadastro, `strategy.opcoes`; sem campo de valor) e valores extras por mês (todos) e por ano (só cliente informal,
// `strategy.opcoes.extraAnual`). Sem renda CLT, 13º e FGTS não aparecem (regras do dono 2026-10-18). O servidor recusa opção
// fora disso e valor de 13º/FGTS do cliente. Valor digitado = reais inteiros com máscara ("300" → "R$ 300,00", teclado
// numérico); campos com fonte ≥ 16px para o Safari do iPhone não dar zoom ao tocar (INCIDENTES, 2026-10-18).
// O cálculo é do motor puro `lib/payment-strategy-core.mjs` (amortização extra REDUZ O PRAZO). "Baixar minha estratégia" pede
// o PDF ao servidor; "Falar com meu corretor" grava as escolhas e recebe o wa.me (só na resposta, nunca no DTO).
// Prévia (`preview`): PDF pelo endpoint do CRM (`pdfEndpoint`); o contato fica desativado.

const OPTIONS = [
  { key: "decimoTerceiro", label: "13º salário", hint: (value) => `${formatBRL(value)} por ano (13º líquido estimado)`, auto: true },
  { key: "fgts", label: "FGTS", hint: (value) => `${formatBRL(value)} a cada 2 anos (8% do salário × 24 meses)`, auto: true },
  { key: "extraMensal", label: "Valor extra por mês", hint: "todo mês, junto da parcela" },
  { key: "extraAnual", label: "Valor extra por ano", hint: "uma vez por ano" }
];
// Nenhuma opção tem mês: o 13º e o valor extra por ano caem sempre em dezembro (regras do dono, 2026-10-19 — os
// seletores de mês saíram; DEFAULT_ANNUAL_EXTRA_MONTH em lib/payment-strategy-core.mjs).

const SYSTEM_LABEL = { price: "Tabela Price", sac: "SAC" };

function moneyText(value) {
  return value > 0 ? formatBRL(value) : "";
}

// Cursor estável na máscara: mantém o mesmo número de dígitos à direita (nunca dentro do ",00" fixo).
function caretDigitsFromEnd(text, caret) {
  return Math.max(2, (String(text).slice(caret ?? text.length).match(/\d/g) || []).length);
}
function caretPosition(text, digitsFromEnd) {
  let seen = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (/\d/.test(text[index])) seen += 1;
    if (seen === digitsFromEnd) {
      // o cursor fica colado ao dígito anterior: "R$ 9,00" com 2 à direita → antes da vírgula (não entre "," e "00",
      // senão o próximo dígito vira centavo e "99999" virava R$ 90.000,00 — achado no teste de largura de 2026-10-18)
      let caret = index;
      while (caret > 0 && !/\d/.test(text[caret - 1])) caret -= 1;
      return caret;
    }
  }
  return 0;
}
function placeCaret(input, digitsFromEnd = 2) {
  if (!input) return;
  requestAnimationFrame(() => {
    if (document.activeElement !== input || !input.value) return;
    const position = caretPosition(input.value, digitsFromEnd);
    try { input.setSelectionRange(position, position); } catch { /* tipo de campo sem seleção: nada a ajustar */ }
  });
}

function initialState(saved, strategy) {
  const choices = restrictChoices(saved ? choicesFromSaved(saved) : emptyChoices(), strategy);
  const texts = {};
  for (const { key, auto } of OPTIONS) texts[key] = auto ? "" : moneyText(choices[key].valor);
  return { choices, texts };
}

function errorMessage(status, fallback) {
  if (status === 400) return "Confira os valores informados.";
  if (status === 429) return "Muitas tentativas. Aguarde um instante e tente de novo.";
  if (status === 404) return "Este link não está mais disponível. Peça um novo link ao seu corretor.";
  return fallback || "Não foi possível concluir agora. Tente de novo em instantes.";
}

export default function StrategySheet({ strategy, token = "", preview = false, pdfEndpoint = "", canContact = false, initialChoices = null, onClose }) {
  const closeRef = useRef(null);
  const [{ choices, texts }, setForm] = useState(() => initialState(initialChoices, strategy));
  const [phase, setPhase] = useState("idle"); // idle | pdf | contact | opening | error
  const [error, setError] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState("");
  const busy = phase === "pdf" || phase === "contact" || phase === "opening";
  const comparison = useMemo(() => compareStrategy(strategy, choices), [strategy, choices]);
  const active = hasActiveExtras(choices, strategy);
  const options = OPTIONS.filter(({ key }) => isOptionAllowed(strategy, key));
  const headline = strategyHeadline(comparison, choices, strategy, formatBRL);
  // Taxa deduzida da parcela (simulação sem taxa gravada) não aparece como "taxa de juros": é só a base do cálculo.
  const rate = strategy?.taxaEstimada ? "" : formatInterestRateLabel(strategy?.taxaAnual);
  const pdfUrl = preview || !token ? pdfEndpoint : `/api/s/${encodeURIComponent(token)}/estrategia`;
  const contactEnabled = canContact && !preview && Boolean(token);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setOption = (key, patch) => setForm((current) => ({ ...current, choices: { ...current.choices, [key]: { ...current.choices[key], ...patch } } }));
  // Reais inteiros com máscara: "300" → "R$ 300,00"; "1000" → "R$ 1.000,00" (STRATEGY_MAX_AMOUNT = R$ 10 milhões).
  const setAmount = (key, input) => {
    const digitsFromEnd = caretDigitsFromEnd(input.value, input.selectionStart);
    // apagou a vírgula do ",00" fixo: vale como apagar o último dígito dos reais (nunca "R$ 300,00" → 30.000)
    const removedComma = String(texts[key]).includes(",") && !input.value.includes(",");
    const typed = removedComma ? String(texts[key]).replace(/,\d*$/, "").replace(/\d$/, "") : input.value;
    const valor = Math.min(wholeReaisFromCurrencyInput(typed), STRATEGY_MAX_AMOUNT);
    const text = valor > 0 ? formatCurrencyInput(String(valor), { cents: true }) : "";
    setForm((current) => ({ texts: { ...current.texts, [key]: text }, choices: { ...current.choices, [key]: { ...current.choices[key], valor, ativo: valor > 0 ? true : current.choices[key].ativo } } }));
    placeCaret(input, digitsFromEnd);
  };

  const downloadPdf = useCallback(async () => {
    if (!pdfUrl || busy) return;
    setPhase("pdf");
    setError("");
    try {
      const body = preview || !token ? { escolhas: choicesForRequest(choices) } : { acao: "pdf", escolhas: choicesForRequest(choices) };
      const response = await fetch(pdfUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: preview ? "same-origin" : "omit" });
      if (!response.ok || !String(response.headers.get("content-type") || "").includes("application/pdf")) {
        const data = await response.json().catch(() => ({}));
        setError(errorMessage(response.status, data?.error));
        setPhase("error");
        return;
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") || "")?.[1] || "estrategia-com-amortizacao.pdf";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setPhase("idle");
    } catch {
      setError("Sem conexão no momento. Verifique a internet e tente de novo.");
      setPhase("error");
    }
  }, [busy, choices, pdfUrl, preview, token]);

  const contact = useCallback(async () => {
    if (!contactEnabled || busy) return;
    setPhase("contact");
    setError("");
    try {
      const response = await fetch(`/api/s/${encodeURIComponent(token)}/estrategia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "contato", escolhas: choicesForRequest(choices) }),
        cache: "no-store",
        credentials: "omit"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(errorMessage(response.status, data?.error));
        setPhase("error");
        return;
      }
      if (!data?.url || typeof data.url !== "string" || !/^https:\/\/wa\.me\//.test(data.url)) {
        setError("Não foi possível abrir o WhatsApp do seu corretor agora. Tente de novo em instantes.");
        setPhase("error");
        return;
      }
      setFallbackUrl(data.url);
      setPhase("opening");
      window.location.assign(data.url);
    } catch {
      setError("Sem conexão no momento. Verifique a internet e tente de novo.");
      setPhase("error");
    }
  }, [busy, choices, contactEnabled, token]);

  if (!strategy || !comparison) return null;
  const { sem, com } = comparison;

  return (
    <div className={styles.sheetBackdrop} data-no-nav="" data-sheet="" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className={`${styles.sheet} ${styles.stSheet}`} role="dialog" aria-modal="true" aria-labelledby="strategy-title" data-st-sheet="">
        <header className={styles.sheetHead}>
          <h2 id="strategy-title" className={styles.sheetTitle}>{STRATEGY_NAME}</h2>
          <button ref={closeRef} type="button" className={styles.sheetClose} onClick={onClose} disabled={busy} aria-label="Fechar">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className={styles.sheetBody} tabIndex={0}>
          <p className={styles.stLabel}>Sua simulação</p>
          <dl className={styles.stBase}>
            <div className={styles.stBaseMain}><dt>Valor financiado</dt><dd>{formatBRL(strategy.financiamento)}</dd></div>
            {rate ? <div><dt>Taxa de juros</dt><dd>{rate}</dd></div> : null}
            <div><dt>Prazo</dt><dd>{strategy.prazoMeses} meses</dd></div>
            <div><dt>Sistema</dt><dd>{SYSTEM_LABEL[strategy.sistema]}</dd></div>
            {strategy.parcela > 0 ? <div><dt>{strategy.sistema === "sac" ? "Primeira parcela" : "Parcela"}</dt><dd>{formatBRL(strategy.parcela)}</dd></div> : null}
          </dl>

          <p className={styles.stLabel}>Use dinheiro extra para quitar antes</p>
          <p className={styles.stHelp}>Cada valor abate o saldo devedor e reduz o prazo: a parcela segue o mesmo sistema, e você termina antes.</p>
          <div className={styles.stOptions}>
            {options.map(({ key, label, hint, auto }) => {
              const option = choices[key];
              const inputId = `st-${key}`;
              return (
                <div key={key} className={`${styles.stOption} ${option.ativo ? styles.stOptionOn : ""}`}>
                  <label className={styles.stToggleRow}>
                    <input type="checkbox" className={styles.stCheck} checked={option.ativo} onChange={(event) => setOption(key, { ativo: event.target.checked })} disabled={busy} data-st-toggle={key} />
                    <span className={styles.stToggleText}>
                      <strong>{label}</strong>
                      <span>{auto ? hint(automaticOptionValue(strategy, key)) : hint}</span>
                    </span>
                  </label>
                  {option.ativo && !auto ? (
                    <div className={styles.stFields}>
                      <label className={styles.stField} htmlFor={inputId}>
                        <span>Valor</span>
                        <span className={styles.stMoney}>
                          <input id={inputId} type="text" inputMode="numeric" autoComplete="off" placeholder="R$ 0,00" value={texts[key]} onChange={(event) => setAmount(key, event.target)} onFocus={(event) => placeCaret(event.target)} disabled={busy} data-st-value={key} />
                        </span>
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className={styles.stCompare} aria-live="polite">
            <div className={styles.stCol}>
              <span className={styles.stColTitle}>Sem amortização</span>
              <strong className={styles.stYears}>{formatDuration(sem.months)}</strong>
              <span className={styles.stLine}>{sem.months} parcelas</span>
              <span className={styles.stLine}>{formatBRL(sem.totalInterest)} de juros</span>
            </div>
            <div className={`${styles.stCol} ${styles.stColOn}`}>
              <span className={styles.stColTitle}>Com amortização</span>
              <strong className={styles.stYears}>{formatDuration(com.months)}</strong>
              <span className={styles.stLine}>{com.months} parcelas</span>
              <span className={styles.stLine}>{formatBRL(com.totalInterest)} de juros</span>
            </div>
          </div>
          <div className={styles.stHighlight} role="status">
            {active && comparison.economiaJuros > 0 ? (
              <>
                <strong>{formatBRL(comparison.economiaJuros)} a menos de juros</strong>
                <span>{headline || `${formatDuration(comparison.mesesAMenos)} a menos de financiamento`}</span>
              </>
            ) : (
              <span>Ligue uma opção e informe o valor para ver quanto você economiza.</span>
            )}
          </div>

          <StrategyBalanceChart comparison={comparison} showStrategy={active} />

          <div className={styles.fcFoot}>
            {pdfUrl ? (
              <button type="button" className={styles.apSecondary} onClick={downloadPdf} disabled={busy} data-st-pdf="">
                <Download aria-hidden="true" />
                {phase === "pdf" ? "Gerando o PDF…" : "Baixar minha estratégia (PDF)"}
              </button>
            ) : null}
            {canContact ? (
              <button type="button" className={styles.fcSubmit} onClick={contact} disabled={!contactEnabled || busy} data-st-contact="">
                <MessageCircle aria-hidden="true" />
                Falar com meu corretor
              </button>
            ) : null}
            {canContact && !contactEnabled ? <p className={styles.fcNote} role="status">Prévia: o contato está desativado</p> : null}
            {phase === "contact" || phase === "opening" ? (
              <p className={styles.fcNote} role="status">
                Abrindo o WhatsApp do seu corretor…
                {phase === "opening" && fallbackUrl ? <> <a href={fallbackUrl} className={styles.fcLink}>Se não abrir, toque aqui</a></> : null}
              </p>
            ) : null}
            {phase === "error" && error ? <p className={`${styles.fcNote} ${styles.fcError}`} role="alert">{error}</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
