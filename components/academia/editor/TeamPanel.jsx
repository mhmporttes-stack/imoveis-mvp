"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import s from "./editor.module.css";
import { certAction, enrollAction, getStudent, listTeam } from "./api";
import ConfirmButton from "./ConfirmButton";

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const STATUS = { assigned: "Atribuída", in_progress: "Em andamento", completed: "Concluída", expired: "Expirada" };
const FILTERS = [["all", "Todos"], ["overdue", "Atrasados"], ["in_progress", "Em andamento"], ["completed", "Concluíram"], ["not_started", "Sem matrícula"]];

// Equipe e andamento (F6): quem está em cada formação, atrasos, histórico, atribuição (com prazo e obrigatoriedade) e certificados.
// Gestor vê e atribui só para a própria equipe (o servidor aplica o escopo); Admin, todos. Nada aqui envia mensagem a ninguém.
export default function TeamPanel({ readOnly, isAdmin, tracks, onError, onNote }) {
  const [data, setData] = useState(null);
  const [trackId, setTrackId] = useState("");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState([]);
  const [assignTrack, setAssignTrack] = useState("");
  const [required, setRequired] = useState(false);
  const [due, setDue] = useState("");
  const [open, setOpen] = useState("");
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await listTeam({ trackId, status: status === "all" ? "" : status, q })); onError(""); } catch (e) { onError(e.message); }
  }, [trackId, status, q, onError]);
  useEffect(() => { load(); }, [load]);

  const call = async (fn, ok) => {
    if (readOnly) { onError('Modo de visualização ("Alterar conta"): nada é gravado.'); return null; }
    setBusy(true); onError(""); onNote("");
    try { const r = await fn(); onNote(ok(r)); await load(); if (open) setDetail(await getStudent(open)); return r; } catch (e) { onError(e.message); return null; } finally { setBusy(false); }
  };
  const assign = () => call(() => enrollAction({ action: "assign", userIds: picked, trackId: assignTrack, required, dueAt: due ? new Date(`${due}T23:59:00`).toISOString() : null }),
    (r) => `Atribuída a ${r.result.created.length} pessoa(s)${r.result.skipped.length ? `; ${r.result.skipped.length} já tinha(m) ou estava(m) inativo(s)` : ""}.`).then((r) => { if (r) setPicked([]); });
  const toggleDetail = async (userId) => {
    if (open === userId) { setOpen(""); setDetail(null); return; }
    setOpen(userId); setDetail(null);
    try { setDetail(await getStudent(userId)); } catch (e) { onError(e.message); }
  };

  return (
    <section aria-label="Equipe e andamento">
      <div className={s.card}>
        <h2>Equipe e andamento</h2>
        {data ? <p className={s.muted}>{data.summary.people} pessoa(s) · {data.summary.withEnrollment} com formação · {data.summary.inProgress} em andamento · {data.summary.completed} concluída(s) · <strong style={{ color: data.summary.overdue ? "var(--ed-bad)" : undefined }}>{data.summary.overdue} atrasada(s)</strong></p> : null}
        <div className={s.row}>
          <label className={`${s.lab} ${s.grow}`} style={{ margin: 0 }}>Buscar<input className={s.in} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou e-mail" /></label>
          <label className={s.lab} style={{ margin: 0 }}>Situação
            <select className={s.sel} value={status} onChange={(e) => setStatus(e.target.value)}>{FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className={s.lab} style={{ margin: 0 }}>Formação
            <select className={s.sel} value={trackId} onChange={(e) => setTrackId(e.target.value)}><option value="">Todas</option>{(data?.tracks || tracks || []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
          </label>
        </div>
      </div>

      <div className={s.card}>
        <h3>Atribuir formação às pessoas marcadas ({picked.length})</h3>
        <div className={s.row}>
          <select className={s.sel} style={{ width: 260 }} aria-label="Formação a atribuir" value={assignTrack} onChange={(e) => setAssignTrack(e.target.value)}>
            <option value="">Escolha a formação…</option>{(data?.tracks || []).filter((t) => t.status === "active").map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <label className={s.lab} style={{ margin: 0 }}><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Obrigatória</label>
          <label className={s.lab} style={{ margin: 0 }}>Prazo (opcional)<input type="date" className={s.in} value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <button type="button" className={`${s.btn} ${s.pri} ${s.sm}`} disabled={busy || readOnly || !picked.length || !assignTrack} onClick={assign}>Atribuir</button>
        </div>
      </div>

      <div className={s.card}>
        {!data ? <p className={s.muted}>Carregando…</p> : data.members.length === 0 ? <p className={s.muted}>Ninguém com este filtro.</p> : (
          <table className={s.tbl}>
            <thead><tr><th /><th>Pessoa</th><th>Formações</th><th /></tr></thead>
            <tbody>
              {data.members.map((m) => (
                <Fragment key={m.userId}>
                  <tr>
                    <td><input type="checkbox" aria-label={`Marcar ${m.name}`} checked={picked.includes(m.userId)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, m.userId] : p.filter((x) => x !== m.userId)))} /></td>
                    <td>{m.name}<br /><span className={s.muted}>{m.role === "manager" ? "Gestor" : m.role === "admin" ? "Admin" : m.role === "associate" ? "Associado" : "Corretor"}</span></td>
                    <td>
                      {m.enrollments.length === 0 ? <span className={s.muted}>Não iniciou</span> : m.enrollments.map((e) => (
                        <div key={e.enrollmentId}>
                          <strong>{e.trackTitle}</strong> · <span className={`${s.badge} ${e.overdue ? s.draft : e.status === "completed" ? s.pub : ""}`}>{e.overdue ? "Atrasada" : STATUS[e.status]}</span>{e.required ? " · obrigatória" : ""} · {e.percent}% ({e.lessonsDone}/{e.lessonsTotal}) · prazo {fmt(e.dueAt)} · última atividade {fmt(e.lastActivityAt)}
                        </div>
                      ))}
                    </td>
                    <td><button type="button" className={`${s.btn} ${s.sm}`} aria-expanded={open === m.userId} onClick={() => toggleDetail(m.userId)}>{open === m.userId ? "Fechar" : "Detalhes"}</button></td>
                  </tr>
                  {open === m.userId ? (
                    <tr><td /><td colSpan={3}>
                      {!detail ? <span className={s.muted}>Carregando…</span> : (
                        <div>
                          {detail.enrollments.map((e) => (
                            <div key={e.enrollmentId} className={s.sub}>
                              <strong>{e.trackTitle}</strong> · {STATUS[e.status]} · {e.attemptsCount} tentativa(s), {e.failedAttempts} não aprovada(s)
                              {e.certificate ? <> · Certificado {e.certificate.code}{e.certificate.revoked ? " (revogado)" : ""}{" "}
                                {!e.certificate.revoked ? <a className={s.link} href={`/api/admin/academia/certificates/${e.certificate.id}/pdf`}>Baixar PDF</a> : null}
                                {isAdmin && !e.certificate.revoked ? <ConfirmButton onConfirm={() => { const reason = window.prompt("Motivo da revogação:"); if (reason && reason.trim().length >= 3) call(() => certAction({ action: "revoke", certificateId: e.certificate.id, reason: reason.trim() }), () => "Certificado revogado."); }}>Revogar</ConfirmButton> : null}
                                {isAdmin && e.certificate.revoked ? <button type="button" className={`${s.btn} ${s.sm}`} onClick={() => call(() => certAction({ action: "reissue", enrollmentId: e.enrollmentId }), (r) => `Certificado reemitido: ${r.result.code}`)}>Reemitir</button> : null}
                              </> : null}
                            </div>
                          ))}
                          <p className={s.lab}>Histórico de provas</p>
                          {detail.attempts.length === 0 ? <p className={s.muted}>Sem tentativas.</p> : (
                            <table className={s.tbl}><thead><tr><th>Prova</th><th>Tentativa</th><th>Nota</th><th>Resultado</th><th>Quando</th></tr></thead>
                              <tbody>{detail.attempts.map((a, i) => <tr key={i}><td>{a.exam}</td><td>{a.number}</td><td>{a.score == null ? "—" : `${String(a.score).replace(".", ",")}%`}</td><td>{a.passed ? "Aprovado" : "Não aprovado"}</td><td>{fmt(a.at)}</td></tr>)}</tbody></table>
                          )}
                        </div>
                      )}
                    </td></tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
