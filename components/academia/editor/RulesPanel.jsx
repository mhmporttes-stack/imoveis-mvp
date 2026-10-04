"use client";

import { useCallback, useEffect, useState } from "react";
import s from "./editor.module.css";
import { listRules, ruleAction } from "./api";
import ConfirmButton from "./ConfirmButton";

const ROLE = { admin: "Admin", manager: "Gestor", broker: "Corretor", associate: "Associado" };
const KIND = { new_user: "Novos usuários (matrícula automática)", recycle: "Reciclagem (refazer depois de concluir)" };

// Regras de matrícula automática (F7), só Admin. Só PREPARAM matrículas; nada é enviado a ninguém. Regra nova nasce DESLIGADA.
export default function RulesPanel({ readOnly, onError, onNote }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({ trackId: "", kind: "new_user" });
  const [sim, setSim] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setData(await listRules()); } catch (e) { onError(e.message); } }, [onError]);
  useEffect(() => { load(); }, [load]);

  const call = async (body, ok) => {
    if (readOnly) { onError('Modo de visualização ("Alterar conta"): nada é gravado.'); return null; }
    setBusy(true); onError(""); onNote("");
    try { const r = await ruleAction(body); onNote(ok(r.result)); await load(); return r.result; } catch (e) { onError(e.message); return null; } finally { setBusy(false); }
  };
  const payload = (r, patch = {}) => ({ action: "save", trackId: r.trackId, kind: r.kind, audienceRoles: r.audienceRoles, dueDays: r.dueDays ?? null, everyDays: r.kind === "recycle" ? r.everyDays ?? null : undefined, ...patch });
  const toggleRole = (r, role) => payload(r, { audienceRoles: r.audienceRoles.includes(role) ? r.audienceRoles.filter((x) => x !== role) : [...r.audienceRoles, role] });

  return (
    <section aria-label="Regras de matrícula automática">
      <div className={s.card}>
        <h2>Regras de matrícula automática</h2>
        <p className={s.muted}>Matriculam sozinhas, com prazo e como obrigatória. <strong>Não enviam mensagem nem notificação.</strong> Novos usuários: vale só para quem foi criado depois da data de início da regra. Regra nova nasce desligada.</p>
        <div className={s.row}>
          <button type="button" className={`${s.btn} ${s.sm}`} disabled={busy} onClick={async () => { const r = await call({ action: "apply", dryRun: true }, (x) => `Simulação: ${x.planned} matrícula(s) seriam criadas agora.`); setSim(r); }}>Simular (quem entraria)</button>
          <ConfirmButton className={s.pri} disabled={busy || readOnly} onConfirm={() => call({ action: "apply" }, (x) => `${x.created} matrícula(s) criada(s).`)}>Aplicar agora</ConfirmButton>
          {sim ? <span className={s.muted}>{sim.planned} pessoa(s) entrariam.</span> : null}
        </div>
      </div>
      {!data ? <p className={s.muted}>Carregando…</p> : data.rules.map((r) => (
        <div key={r.id} className={s.card}>
          <div className={s.row}>
            <h3 className={s.grow} style={{ margin: 0 }}>{r.trackTitle} · {KIND[r.kind]}</h3>
            <span className={`${s.badge} ${r.active ? s.pub : s.old}`}>{r.active ? "Ligada" : "Desligada"}</span>
          </div>
          <p className={s.muted}>Início: {new Date(r.startsAt).toLocaleDateString("pt-BR")}</p>
          <div className={s.row}>
            {Object.keys(ROLE).map((role) => <label key={role} className={s.lab} style={{ margin: 0 }}><input type="checkbox" disabled={readOnly || busy} checked={r.audienceRoles.includes(role)} onChange={() => r.audienceRoles.length === 1 && r.audienceRoles.includes(role) ? null : call(toggleRole(r, role), () => "Regra salva.")} /> {ROLE[role]}</label>)}
          </div>
          <div className={s.row} style={{ marginTop: 8 }}>
            <label className={s.lab} style={{ margin: 0 }}>Prazo (dias)<input className={s.in} style={{ width: 110 }} inputMode="numeric" defaultValue={r.dueDays ?? ""} disabled={readOnly || busy} onBlur={(e) => { const v = e.target.value.replace(/\D/g, ""); if ((v ? Number(v) : null) !== (r.dueDays ?? null)) call(payload(r, { dueDays: v ? Number(v) : null }), () => "Regra salva."); }} /></label>
            {r.kind === "recycle" ? <label className={s.lab} style={{ margin: 0 }}>Refazer a cada (dias, mín. 30)<input className={s.in} style={{ width: 130 }} inputMode="numeric" defaultValue={r.everyDays ?? ""} disabled={readOnly || busy} onBlur={(e) => { const v = Number(e.target.value.replace(/\D/g, "")); if (v && v !== r.everyDays) call(payload(r, { everyDays: v }), () => "Regra salva."); }} /></label> : null}
            <button type="button" className={`${s.btn} ${s.sm} ${r.active ? "" : s.pri}`} disabled={readOnly || busy} onClick={() => call(payload(r, { active: !r.active }), () => (r.active ? "Regra desligada." : "Regra ligada."))}>{r.active ? "Desligar" : "Ligar"}</button>
          </div>
        </div>
      ))}
      <div className={s.card}>
        <h3>Nova regra</h3>
        <div className={s.row}>
          <select className={s.sel} style={{ width: 260 }} aria-label="Trilha da nova regra" value={draft.trackId} onChange={(e) => setDraft({ ...draft, trackId: e.target.value })}>
            <option value="">Escolha a trilha…</option>{(data?.tracks || []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <select className={s.sel} style={{ width: 300 }} aria-label="Tipo da nova regra" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>{Object.entries(KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button type="button" className={`${s.btn} ${s.sm}`} disabled={busy || readOnly || !draft.trackId} onClick={() => call({ action: "save", trackId: draft.trackId, kind: draft.kind, audienceRoles: ["broker", "associate"], dueDays: 30, ...(draft.kind === "recycle" ? { everyDays: 365 } : {}) }, () => "Regra criada (desligada).")}>Criar (desligada)</button>
        </div>
      </div>
    </section>
  );
}
