"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, MessageCircle, X } from "lucide-react";
import { formatBRL } from "@/lib/simulation-presentation-format.mjs";
import { formatInterestRateLabel } from "@/lib/interest-rate.mjs";
import { parseSimulationMoney } from "@/lib/simulation-models.js";
import {
  DEFAULT_13TH_MONTH,
  DEFAULT_ANNUAL_EXTRA_MONTH,
  MONTH_NAMES,
  STRATEGY_NAME,
  balanceChartPaths,
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
import styles from "./presentation.module.css";

// Folha "Estratégia de pagamento" (PRES-24). Abre com os números da simulação (`strategy` = base do DTO, nunca redigitada) e
// deixa o cliente — ou o corretor, na prévia do CRM — ligar 13º e FGTS (AUTOMÁTICOS: valor calculado no servidor pela renda
// CLT do cadastro, `strategy.opcoes`; sem campo de valor) e valores extras por mês e por ano (editáveis, para todos). Sem renda
// CLT, 13º e FGTS não aparecem (regras do dono 2026-10-18). O servidor recusa opção fora disso e valor de 13º/FGTS do cliente.
// O cálculo é do motor puro `lib/payment-strategy-core.mjs` (amortização extra REDUZ O PRAZO). "Baixar minha estratégia" pede
// o PDF ao servidor; "Falar com meu corretor" grava as escolhas e recebe o wa.me (só na resposta, nunca no DTO).
// Prévia (`preview`): PDF pelo endpoint do CRM (`pdfEndpoint`); o contato fica desativado.

const OPTIONS = [
  { key: "decimoTerceiro", label: "13º salário", hint: (value) => `${formatBRL(value)} por ano (1 salário)`, auto: true },
  { key: "fgts", label: "FGTS", hint: (value) => `${formatBRL(value)} a cada 2 anos (8% do salário × 24 meses)`, auto: true },
  { key: "extraMensal", label: "Valor extra por mês", hint: "todo mês, junto da parcela" },
  { key: "extraAnual", label: "Valor extra por ano", hint: "uma vez por ano, no mês escolhido" }
];
const MONTH_DEFAULTS = { decimoTerceiro: DEFAULT_13TH_MONTH, extraAnual: DEFAULT_ANNUAL_EXTRA_MONTH };

const SYSTEM_LABEL = { price: "Tabela Price", sac: "SAC" };
const CHART_W = 320;
const CHART_H = 140;

function moneyText(value) {
  return value > 0 ? formatBRL(value).replace(/^R\$\s*/, "") : "";
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
  const paths = useMemo(() => balanceChartPaths(comparison, { width: CHART_W, height: CHART_H }), [comparison]);
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
  const setAmount = (key, text) => {
    const clean = text.replace(/[^\d.,]/g, "").slice(0, 14);
    const valor = Math.min(parseSimulationMoney(clean), 10_000_000);
    setForm((current) => ({ texts: { ...current.texts, [key]: clean }, choices: { ...current.choices, [key]: { ...current.choices[key], valor, ativo: valor > 0 ? true : current.choices[key].ativo } } }));
  };
  const formatAmount = (key) => setForm((current) => ({ ...current, texts: { ...current.texts, [key]: moneyText(current.choices[key].valor) } }));

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
  const years = Math.max(1, Math.ceil(sem.months / 12));

  return (
    <div className={styles.sheetBackdrop} data-no-nav="" data-sheet="" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="strategy-title">
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
                  {option.ativo && (!auto || MONTH_DEFAULTS[key]) ? (
                    <div className={styles.stFields}>
                      {auto ? null : (
                      <label className={styles.stField} htmlFor={inputId}>
                        <span>Valor</span>
                        <span className={styles.stMoney}>
                          <span aria-hidden="true">R$</span>
                          <input id={inputId} inputMode="decimal" autoComplete="off" placeholder="0,00" value={texts[key]} onChange={(event) => setAmount(key, event.target.value)} onBlur={() => formatAmount(key)} disabled={busy} data-st-value={key} />
                        </span>
                      </label>
                      )}
                      {MONTH_DEFAULTS[key] ? (
                        <label className={styles.stField} htmlFor={`st-mes-${key}`}>
                          <span>Mês</span>
                          <select id={`st-mes-${key}`} className={styles.stSelect} value={option.mes || MONTH_DEFAULTS[key]} onChange={(event) => setOption(key, { mes: Number(event.target.value) })} disabled={busy}>
                            {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
                          </select>
                        </label>
                      ) : null}
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

          <figure className={styles.stChart}>
            <figcaption className={styles.stLabel}>Saldo devedor ao longo do tempo</figcaption>
            <svg viewBox={`-2 -4 ${CHART_W + 4} ${CHART_H + 8}`} role="img" aria-label={`Sem amortização o saldo zera em ${formatDuration(sem.months)}; com amortização, em ${formatDuration(com.months)}.`}>
              <line x1="0" y1={CHART_H} x2={CHART_W} y2={CHART_H} className={styles.stAxis} />
              <path d={paths.sem} className={styles.stPathSem} />
              <path d={paths.com} className={styles.stPathCom} />
            </svg>
            <div className={styles.stChartScale}><span>hoje</span><span>{years} {years === 1 ? "ano" : "anos"}</span></div>
            <div className={styles.stLegend}>
              <span><i className={styles.stDotSem} aria-hidden="true" />Sem amortização</span>
              <span><i className={styles.stDotCom} aria-hidden="true" />Com amortização</span>
            </div>
          </figure>

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
