"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, MapPin, MessageCircle, Video, X } from "lucide-react";
import { describeForecastDate, forecastWindow } from "@/lib/documents-forecast-core.mjs";
import { APPOINTMENT_REQUEST_MAX, APPOINTMENT_UNAVAILABLE_LABEL, buildPreviewAgenda } from "@/lib/client-appointments-core.mjs";
import { COMPANY_ADDRESS, COMPANY_MAPS_URL } from "@/lib/company-info.mjs";
import styles from "./presentation.module.css";

// Folha "Agendar atendimento" (cena "Próximo passo", PRES-22). O cliente escolhe presencial/online, um dia dos próximos 10 e
// um horário de 30 min. A agenda (livre/"Indisponível") vem PRONTA do servidor (GET /api/s/<token>/agendamento): este
// componente não sabe por que um horário está indisponível e não calcula nada além de datas de exibição. "Combinar outro
// horário" não reserva: registra o pedido e leva ao WhatsApp do corretor.
// Prévia do CRM (`preview` ou sem token): agenda de exibição sem sorteio, botões finais desativados, nada é enviado.

const KIND_OPTIONS = [
  { value: "presencial", label: "Presencial", Icon: MapPin },
  { value: "online", label: "Online (Meet)", Icon: Video }
];

function messageFor(status, serverMessage) {
  if (status === 429) return "Muitas tentativas. Aguarde um instante e tente de novo.";
  if (status === 404) return "Este link não está mais disponível. Peça um novo link ao seu corretor.";
  return serverMessage || "Não foi possível concluir agora. Tente de novo em instantes.";
}

function isWhatsappUrl(url) {
  return typeof url === "string" && /^https:\/\/wa\.me\//.test(url);
}

export default function AppointmentSheet({ token = "", preview = false, onClose }) {
  const closeRef = useRef(null);
  const disabledByPreview = preview || !token;
  const [agenda, setAgenda] = useState(() => (disabledByPreview ? buildPreviewAgenda(new Date()) : null));
  const [meet, setMeet] = useState(disabledByPreview);
  const [booked, setBooked] = useState(null); // { id, tipo, data, hora, dia, ics, google } + url (só logo após reservar)
  const [loadError, setLoadError] = useState("");
  const [kind, setKind] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [mode, setMode] = useState("book"); // book | request
  const [requestDate, setRequestDate] = useState("");
  const [requestText, setRequestText] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | sending | opening | error
  const [error, setError] = useState("");
  const [missing, setMissing] = useState("");
  const busy = phase === "sending" || phase === "opening";
  const requestDays = useMemo(() => forecastWindow(new Date()).map((iso) => describeForecastDate(iso)), []);

  const load = useCallback(async () => {
    if (disabledByPreview) return;
    setLoadError("");
    setAgenda(null);
    try {
      const response = await fetch(`/api/s/${encodeURIComponent(token)}/agendamento`, { cache: "no-store", credentials: "omit" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(body?.dias)) {
        setLoadError(messageFor(response.status, body?.error));
        return;
      }
      setAgenda(body.dias);
      setMeet(body.meet === true);
      setBooked(body.agendado || null);
    } catch {
      setLoadError("Sem conexão no momento. Verifique a internet e tente de novo.");
    }
  }, [disabledByPreview, token]);

  useEffect(() => {
    load();
  }, [load]);

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

  const day = agenda?.find((item) => item.date === date) || null;
  const parts = useMemo(() => {
    const slots = day?.slots || [];
    return [
      { label: "Manhã", slots: slots.filter((slot) => slot.time < "12:00") },
      { label: "Tarde", slots: slots.filter((slot) => slot.time >= "12:00") }
    ].filter((part) => part.slots.length);
  }, [day]);

  const post = useCallback(async (path, payload) => {
    setPhase("sending");
    setError("");
    try {
      const response = await fetch(`/api/s/${encodeURIComponent(token)}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        credentials: "omit"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(messageFor(response.status, body?.error));
        setPhase("error");
        if (response.status === 409 && body?.agendado) setBooked(body.agendado);
        else if (response.status === 409 || response.status === 400) {
          setTime("");
          load();
        }
        return null;
      }
      return body;
    } catch {
      setError("Sem conexão no momento. Verifique a internet e tente de novo.");
      setPhase("error");
      return null;
    }
  }, [load, token]);

  const submitBooking = useCallback(async () => {
    if (disabledByPreview || busy) return;
    if (!kind || !date || !time) {
      setMissing(!kind ? "kind" : !date ? "date" : "time");
      return;
    }
    const body = await post("agendamento", { tipo: kind, data: date, hora: time });
    if (!body) return;
    setBooked({ ...(body.agendado || {}), url: isWhatsappUrl(body.url) ? body.url : "" });
    setPhase("idle");
  }, [busy, date, disabledByPreview, kind, post, time]);

  const submitRequest = useCallback(async () => {
    if (disabledByPreview || busy) return;
    if (!kind || !requestDate || requestText.trim().length < 2) {
      setMissing(!kind ? "kind" : !requestDate ? "requestDate" : "requestText");
      return;
    }
    const body = await post("agendamento/outro-horario", { tipo: kind, data: requestDate, texto: requestText.trim() });
    if (!body) return;
    if (!isWhatsappUrl(body.url)) {
      setError("Não foi possível abrir o WhatsApp do seu corretor agora. Tente de novo em instantes.");
      setPhase("error");
      return;
    }
    setPhase("opening");
    window.location.assign(body.url);
  }, [busy, disabledByPreview, kind, post, requestDate, requestText]);

  const title = booked ? "Atendimento agendado" : "Agendar atendimento";
  const bookedKind = booked?.tipo || kind;

  return (
    <div className={styles.sheetBackdrop} data-no-nav="" data-sheet="" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="appointment-title">
        <header className={styles.sheetHead}>
          <h2 id="appointment-title" className={styles.sheetTitle}>{title}</h2>
          <button ref={closeRef} type="button" className={styles.sheetClose} onClick={onClose} disabled={busy} aria-label="Fechar">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className={styles.sheetBody} tabIndex={0}>
          {booked ? (
            <div className={styles.apDone} role="status">
              <p className={styles.apDoneWhen}>
                {bookedKind === "presencial" ? "Atendimento presencial" : "Reunião online (Google Meet)"}
                <strong>{booked.dia}, às {booked.hora}</strong>
              </p>
              {bookedKind === "presencial" ? (
                <p className={styles.apInfo}><MapPin aria-hidden="true" />{COMPANY_ADDRESS} · <a className={styles.fcLink} href={COMPANY_MAPS_URL} target="_blank" rel="noopener noreferrer">Abrir no mapa</a></p>
              ) : (
                <p className={styles.apInfo}><Video aria-hidden="true" />{meet ? "O link da reunião está no convite da agenda." : "O link da reunião será enviado pelo seu corretor no WhatsApp."}</p>
              )}
              <div className={styles.fcFoot}>
                {booked.url ? (
                  <a className={styles.fcSubmit} href={booked.url} data-ap-whatsapp="">
                    <MessageCircle aria-hidden="true" />
                    Avisar meu corretor no WhatsApp
                  </a>
                ) : null}
                {booked.ics ? (
                  <a className={styles.apSecondary} href={booked.ics} download="atendimento-matheus-machado.ics">
                    <CalendarPlus aria-hidden="true" />
                    Adicionar à minha agenda
                  </a>
                ) : null}
                {booked.google ? <a className={styles.fcLink} href={booked.google} target="_blank" rel="noopener noreferrer" style={{ textAlign: "center" }}>Adicionar ao Google Agenda</a> : null}
                {!booked.url ? <p className={styles.fcNote}>Para mudar o horário, fale com seu corretor pelo WhatsApp.</p> : null}
              </div>
            </div>
          ) : (
            <>
              <fieldset className={styles.fcGroup} disabled={busy}>
                <legend className={styles.fcQuestion}>Como você prefere ser atendido?</legend>
                <div className={`${styles.apKinds} ${missing === "kind" ? styles.fcMissing : ""}`} role="group" aria-label="Tipo de atendimento">
                  {KIND_OPTIONS.map(({ value, label, Icon }) => (
                    <button key={value} type="button" aria-pressed={kind === value} className={`${styles.fcPeriod} ${kind === value ? styles.fcOn : ""}`} onClick={() => { setKind(value); setMissing(""); }} data-ap-kind={value}>
                      <Icon aria-hidden="true" className={styles.apKindIcon} />
                      {label}
                    </button>
                  ))}
                </div>
                {kind === "presencial" ? (
                  <p className={styles.apInfo}><MapPin aria-hidden="true" />{COMPANY_ADDRESS} · <a className={styles.fcLink} href={COMPANY_MAPS_URL} target="_blank" rel="noopener noreferrer">Abrir no mapa</a></p>
                ) : null}
                {kind === "online" ? (
                  <p className={styles.apInfo}><Video aria-hidden="true" />{meet ? "Reunião pelo Google Meet: o link vai no convite da agenda." : "Reunião pelo Google Meet: o link será enviado pelo seu corretor no WhatsApp."}</p>
                ) : null}
              </fieldset>

              {mode === "book" ? (
                <>
                  {loadError ? (
                    <div className={styles.fcFoot}>
                      <p className={`${styles.fcNote} ${styles.fcError}`} role="alert">{loadError}</p>
                      <button type="button" className={styles.apText} onClick={load}>Tentar de novo</button>
                    </div>
                  ) : !agenda ? (
                    <p className={styles.fcNote} role="status">Carregando horários…</p>
                  ) : (
                    <>
                      <fieldset className={styles.fcGroup} disabled={busy}>
                        <legend className={styles.fcQuestion}>Escolha o dia</legend>
                        <div className={`${styles.fcDays} ${missing === "date" ? styles.fcMissing : ""}`} role="group" aria-label="Dia do atendimento">
                          {agenda.map((item, index) => {
                            const info = describeForecastDate(item.date);
                            const closed = item.slots.length === 0;
                            const selected = date === item.date;
                            return (
                              <button
                                key={item.date}
                                type="button"
                                aria-pressed={selected}
                                disabled={closed}
                                aria-label={`${info.weekday}, ${info.day} de ${info.month}${index === 0 ? " (hoje)" : ""}${closed ? ": sem atendimento" : ""}`}
                                className={`${styles.fcDay} ${selected ? styles.fcOn : ""} ${closed ? styles.apDayOff : ""}`}
                                onClick={() => { setDate(item.date); setTime(""); setMissing(""); }}
                                data-ap-day={item.date}
                              >
                                <span className={styles.fcWeek}>{index === 0 ? "hoje" : info.weekdayShort}</span>
                                <span className={styles.fcNum}>{info.day}</span>
                                <span className={styles.fcMonth}>{closed ? "fechado" : info.monthShort}</span>
                              </button>
                            );
                          })}
                        </div>
                      </fieldset>

                      {day ? (
                        <fieldset className={styles.fcGroup} disabled={busy}>
                          <legend className={styles.fcQuestion}>Escolha o horário</legend>
                          <div className={missing === "time" ? styles.fcMissing : ""}>
                            {parts.map((part) => (
                              <div key={part.label} className={styles.apPart}>
                                <p className={styles.apPartLabel}>{part.label}</p>
                                <div className={styles.apSlots} role="group" aria-label={`Horários da ${part.label.toLowerCase()}`}>
                                  {part.slots.map((slot) => (
                                    <button
                                      key={slot.time}
                                      type="button"
                                      disabled={!slot.available}
                                      aria-pressed={time === slot.time}
                                      aria-label={slot.available ? slot.time : `${slot.time}: ${APPOINTMENT_UNAVAILABLE_LABEL}`}
                                      className={`${styles.apSlot} ${time === slot.time ? styles.fcOn : ""} ${slot.available ? "" : styles.apSlotOff}`}
                                      onClick={() => { setTime(slot.time); setMissing(""); }}
                                      data-ap-slot={slot.time}
                                    >
                                      <span>{slot.time}</span>
                                      {slot.available ? null : <span className={styles.apSlotNote}>{APPOINTMENT_UNAVAILABLE_LABEL}</span>}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </fieldset>
                      ) : null}

                      <div className={styles.fcFoot}>
                        <button type="button" className={`${styles.fcSubmit} ${kind && date && time && !disabledByPreview ? "" : styles.fcSubmitOff}`} onClick={submitBooking} disabled={disabledByPreview || busy} data-ap-submit="">
                          <CalendarPlus aria-hidden="true" />
                          Confirmar agendamento
                        </button>
                        {missing === "kind" || missing === "date" || missing === "time" ? (
                          <p className={`${styles.fcNote} ${styles.fcError}`} role="alert">
                            {missing === "kind" ? "Escolha presencial ou online." : missing === "date" ? "Escolha o dia do atendimento." : "Escolha um horário disponível."}
                          </p>
                        ) : null}
                        <button type="button" className={styles.apText} onClick={() => { setMode("request"); setMissing(""); setError(""); setPhase("idle"); }} disabled={busy} data-ap-other="">
                          Nenhum horário serve? Combinar outro horário
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <fieldset className={styles.fcGroup} disabled={busy}>
                    <legend className={styles.fcQuestion}>Qual dia fica melhor para você?</legend>
                    <div className={`${styles.fcDays} ${missing === "requestDate" ? styles.fcMissing : ""}`} role="group" aria-label="Dia desejado">
                      {requestDays.map((info, index) => (
                        <button
                          key={info.iso}
                          type="button"
                          aria-pressed={requestDate === info.iso}
                          aria-label={`${info.weekday}, ${info.day} de ${info.month}${index === 0 ? " (hoje)" : ""}`}
                          className={`${styles.fcDay} ${requestDate === info.iso ? styles.fcOn : ""}`}
                          onClick={() => { setRequestDate(info.iso); setMissing(""); }}
                        >
                          <span className={styles.fcWeek}>{index === 0 ? "hoje" : info.weekdayShort}</span>
                          <span className={styles.fcNum}>{info.day}</span>
                          <span className={styles.fcMonth}>{info.monthShort}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label className={styles.apField}>
                    <span className={styles.fcQuestion}>Qual horário você prefere?</span>
                    <input
                      className={`${styles.apInput} ${missing === "requestText" ? styles.fcMissing : ""}`}
                      type="text"
                      value={requestText}
                      maxLength={APPOINTMENT_REQUEST_MAX}
                      placeholder="Ex.: depois das 19h"
                      onChange={(event) => { setRequestText(event.target.value); setMissing(""); }}
                      disabled={busy}
                    />
                  </label>
                  <div className={styles.fcFoot}>
                    <button type="button" className={`${styles.fcSubmit} ${kind && requestDate && requestText.trim().length >= 2 && !disabledByPreview ? "" : styles.fcSubmitOff}`} onClick={submitRequest} disabled={disabledByPreview || busy} data-ap-request="">
                      <MessageCircle aria-hidden="true" />
                      Combinar pelo WhatsApp
                    </button>
                    {missing === "kind" || missing === "requestDate" || missing === "requestText" ? (
                      <p className={`${styles.fcNote} ${styles.fcError}`} role="alert">
                        {missing === "kind" ? "Escolha presencial ou online." : missing === "requestDate" ? "Escolha o dia." : "Escreva o horário que você prefere."}
                      </p>
                    ) : null}
                    {phase === "opening" ? <p className={styles.fcNote} role="status">Abrindo o WhatsApp do seu corretor…</p> : null}
                    <button type="button" className={styles.apText} onClick={() => { setMode("book"); setMissing(""); setError(""); setPhase("idle"); }} disabled={busy}>
                      Voltar aos horários disponíveis
                    </button>
                  </div>
                </>
              )}
              {disabledByPreview ? <p className={styles.fcNote} role="status">Prévia: o agendamento está desativado</p> : null}
              {phase === "sending" ? <p className={styles.fcNote} role="status">Enviando…</p> : null}
              {phase === "error" && error ? <p className={`${styles.fcNote} ${styles.fcError}`} role="alert">{error}</p> : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
