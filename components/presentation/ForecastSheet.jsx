"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { FORECAST_PERIODS, FORECAST_PERIOD_LABEL, describeForecastDate, forecastWindow } from "@/lib/documents-forecast-core.mjs";
import styles from "./presentation.module.css";

// Folha "Receber lista de documentos": o cliente escolhe QUANDO acredita que conseguirá enviar toda a documentação
// (calendário com SÓ os próximos 10 dias: hoje + 9, fuso de São Paulo) e o período (manhã, tarde ou noite). Ao confirmar,
// o servidor grava o compromisso e devolve o link do WhatsApp do corretor com a mensagem pronta; o cliente é levado para lá.
// Este componente nunca vê o telefone do corretor antes da confirmação e nunca calcula nada além de datas de exibição.
// Prévia do CRM (`preview` ou sem token): o painel abre, mas o botão final fica desativado e nada é enviado.

function messageFor(status, serverMessage) {
  if (status === 400) return "Escolha uma das datas disponíveis e um período.";
  if (status === 429) return "Muitas tentativas. Aguarde um instante e tente de novo.";
  if (status === 404) return "Este link não está mais disponível. Peça um novo link ao seu corretor.";
  return serverMessage || "Não foi possível concluir agora. Tente de novo em instantes.";
}

export default function ForecastSheet({ token = "", preview = false, onClose }) {
  const closeRef = useRef(null);
  const [now, setNow] = useState(() => new Date());
  const days = useMemo(() => forecastWindow(now).map((iso) => describeForecastDate(iso)), [now]);
  const [date, setDate] = useState("");
  const [period, setPeriod] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | sending | opening | error
  const [error, setError] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState("");
  const disabledByPreview = preview || !token;
  const busy = phase === "sending" || phase === "opening";

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

  const submit = useCallback(async () => {
    if (disabledByPreview || busy || !date || !period) return;
    setPhase("sending");
    setError("");
    try {
      const response = await fetch(`/api/s/${encodeURIComponent(token)}/documentos-previsao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: date, periodo: period }),
        cache: "no-store",
        credentials: "omit"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 400) {
          // relógio do aparelho fora do compasso: recalcula a janela e pede nova escolha
          setNow(new Date());
          setDate("");
        }
        setError(messageFor(response.status, body?.error));
        setPhase("error");
        return;
      }
      if (!body?.url || typeof body.url !== "string" || !/^https:\/\/wa\.me\//.test(body.url)) {
        setError("Não foi possível abrir o WhatsApp do seu corretor agora. Tente de novo em instantes.");
        setPhase("error");
        return;
      }
      setFallbackUrl(body.url);
      setPhase("opening");
      window.location.assign(body.url);
    } catch {
      setError("Sem conexão no momento. Verifique a internet e tente de novo.");
      setPhase("error");
    }
  }, [busy, date, disabledByPreview, period, token]);

  const ready = Boolean(date && period) && !disabledByPreview && !busy;

  return (
    <div className={styles.sheetBackdrop} data-no-nav="" data-sheet="" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="forecast-title">
        <header className={styles.sheetHead}>
          <h2 id="forecast-title" className={styles.sheetTitle}>Receber lista de documentos</h2>
          <button ref={closeRef} type="button" className={styles.sheetClose} onClick={onClose} disabled={busy} aria-label="Fechar">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className={styles.sheetBody} tabIndex={0}>
          <fieldset className={styles.fcGroup} disabled={busy}>
            <legend className={styles.fcQuestion}>Quando você acredita que conseguirá enviar toda a documentação para validarmos a sua aprovação?</legend>
            <div className={styles.fcDays} role="group" aria-label="Dia previsto para enviar os documentos">
              {days.map((day, index) => {
                const selected = date === day.iso;
                return (
                  <button
                    key={day.iso}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${day.weekday}, ${day.day} de ${day.month}${index === 0 ? " (hoje)" : ""}`}
                    className={`${styles.fcDay} ${selected ? styles.fcOn : ""}`}
                    onClick={() => setDate(day.iso)}
                    data-fc-day={day.iso}
                  >
                    <span className={styles.fcWeek}>{index === 0 ? "hoje" : day.weekdayShort}</span>
                    <span className={styles.fcNum}>{day.day}</span>
                    <span className={styles.fcMonth}>{day.monthShort}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {date ? (
            <fieldset className={styles.fcGroup} disabled={busy}>
              <legend className={styles.fcQuestion}>Em qual período do dia?</legend>
              <div className={styles.fcPeriods} role="group" aria-label="Período do dia">
                {FORECAST_PERIODS.map((value) => {
                  const selected = period === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={selected}
                      className={`${styles.fcPeriod} ${selected ? styles.fcOn : ""}`}
                      onClick={() => setPeriod(value)}
                      data-fc-period={value}
                    >
                      {FORECAST_PERIOD_LABEL[value].replace(/^./, (letter) => letter.toUpperCase())}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <div className={styles.fcFoot}>
            <button type="button" className={styles.fcSubmit} onClick={submit} disabled={!ready} aria-disabled={!ready} data-fc-submit="">
              <MessageCircle aria-hidden="true" />
              Receber lista de documentos necessários
            </button>
            {disabledByPreview ? <p className={styles.fcNote} role="status">Prévia: o envio está desativado</p> : null}
            {phase === "sending" || phase === "opening" ? (
              <p className={styles.fcNote} role="status">
                Abrindo o WhatsApp do seu corretor…
                {phase === "opening" && fallbackUrl ? (
                  <>
                    {" "}
                    <a href={fallbackUrl} className={styles.fcLink}>Se não abrir, toque aqui</a>
                  </>
                ) : null}
              </p>
            ) : null}
            {phase === "error" && error ? <p className={`${styles.fcNote} ${styles.fcError}`} role="alert">{error}</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
