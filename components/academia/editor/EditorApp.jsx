"use client";

import { useCallback, useEffect, useState } from "react";
import s from "./editor.module.css";
import { academiaSans, academiaSerif } from "../fonts";
import { act, getVersion, listTracks } from "./api";
import GrantsPanel from "./GrantsPanel";
import VersionEditor from "./VersionEditor";

const STATUS = { draft: "Rascunho", published: "Publicada", retired: "Aposentada" };
const BADGE = { draft: "draft", published: "pub", retired: "old" };
const ACTION_LABEL = { draft_created: "Rascunho criado", version_published: "Versão publicada", draft_discarded: "Rascunho descartado" };
const fmt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");

// Gestão da Academia (F3) para Admin e Gerente: versões, edição do rascunho, publicação e liberação de tentativa extra.
// Toda regra (permissão, rascunho x publicada, validação) é do servidor; aqui só chamadas às rotas.
export default function EditorApp({ readOnly = false, backHref = "/academia" }) {
  const [tab, setTab] = useState("content");
  const [tracks, setTracks] = useState(null);
  const [trackId, setTrackId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [tree, setTree] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [draftNote, setDraftNote] = useState("");

  const refreshTracks = useCallback(async () => {
    const { tracks: list } = await listTracks();
    setTracks(list);
    setTrackId((cur) => cur || list[0]?.id || "");
    return list;
  }, []);
  const refreshTree = useCallback(async (id) => {
    if (!id) { setTree(null); return; }
    setTree(await getVersion(id));
  }, []);

  useEffect(() => { refreshTracks().catch((e) => setError(e.message)); }, [refreshTracks]);
  useEffect(() => { refreshTree(versionId).catch((e) => setError(e.message)); }, [versionId, refreshTree]);

  const track = tracks?.find((t) => t.id === trackId) || null;

  // Executa uma ação de gestão e recarrega. `opts.closeVersion` fecha a versão aberta (ex.: rascunho descartado).
  const run = useCallback(async (action, input, okMessage, opts = {}) => {
    if (readOnly) { setError('Modo de visualização ("Alterar conta"): nada é gravado.'); return; }
    setBusy(true); setError(""); setNote("");
    try {
      const { result } = await act(action, input);
      if (okMessage) setNote(okMessage);
      const list = await refreshTracks();
      if (opts.closeVersion) { setVersionId(""); setTree(null); }
      else if (action === "createDraft") setVersionId(result.versionId);
      else if (action === "publish") await refreshTree(result.versionId);
      else if (versionId) await refreshTree(versionId);
      return { result, list };
    } catch (e) {
      setError(e.code === "publish_blocked" && e.extra?.issues?.length ? `${e.message} ${e.extra.issues.map((i) => i.message).join(" ")}` : e.message);
      if (versionId) refreshTree(versionId).catch(() => {});
    } finally { setBusy(false); }
  }, [readOnly, refreshTracks, refreshTree, versionId]);

  const published = track?.versions.find((v) => v.status === "published");
  const hasDraft = track?.versions.some((v) => v.status === "draft");

  return (
    <div className={`${s.ed} ${academiaSerif.variable} ${academiaSans.variable}`} lang="pt-BR">
      <div className={s.wrap}>
        <div className={s.top}>
          <h1>Gestão da Academia</h1>
          <a className={s.link} href={backHref}>Voltar à Academia</a>
        </div>
        <div className={s.tabs} role="tablist" aria-label="Seções da gestão">
          <button type="button" role="tab" className={s.tab} aria-selected={tab === "content"} onClick={() => setTab("content")}>Conteúdo</button>
          <button type="button" role="tab" className={s.tab} aria-selected={tab === "grants"} onClick={() => setTab("grants")}>Liberações de tentativa</button>
        </div>
        {readOnly ? <p className={`${s.msg} ${s.err}`}>Modo de visualização ("Alterar conta"): você pode ver, mas nada é gravado.</p> : null}
        {error ? <p className={`${s.msg} ${s.err}`} role="alert">{error}</p> : null}
        {note ? <p className={`${s.msg} ${s.ok}`} role="status">{note}</p> : null}

        {tab === "grants" ? <GrantsPanel readOnly={readOnly} /> : null}

        {tab === "content" ? (
          !tracks ? <p className={s.muted}>Carregando…</p> : !track ? <p className={s.muted}>Nenhuma trilha cadastrada.</p> : (
            <>
              <div className={s.card}>
                <div className={s.row}>
                  <label className={`${s.lab} ${s.grow}`} style={{ margin: 0 }}>Trilha
                    <select className={s.sel} value={trackId} onChange={(e) => { setTrackId(e.target.value); setVersionId(""); setTree(null); }}>
                      {tracks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                    </select>
                  </label>
                </div>
                <h2 style={{ marginTop: 14 }}>Versões</h2>
                <p className={s.muted}>O que está publicado nunca muda. Para editar, crie um rascunho; ao publicar, alunos novos entram na versão nova e quem já começou continua na versão em que estava.</p>
                <table className={s.tbl}>
                  <thead><tr><th>Versão</th><th>Situação</th><th>Publicada em</th><th>Por</th><th>Nota</th><th /></tr></thead>
                  <tbody>
                    {track.versions.map((v) => (
                      <tr key={v.id}>
                        <td>v{v.number}</td>
                        <td><span className={`${s.badge} ${s[BADGE[v.status]]}`}>{STATUS[v.status]}</span></td>
                        <td>{fmt(v.publishedAt) || "—"}</td><td>{v.publishedBy || "—"}</td><td>{v.changeNote || "—"}</td>
                        <td>
                          <div className={s.row}>
                            <button type="button" className={`${s.btn} ${s.sm}`} aria-pressed={versionId === v.id} onClick={() => setVersionId(v.id)}>{v.status === "draft" ? "Editar" : "Ver"}</button>
                            {v.status !== "draft" && !hasDraft ? <button type="button" className={`${s.btn} ${s.sm}`} disabled={busy || readOnly} onClick={() => run("createDraft", { trackId: track.id, fromVersionId: v.id, note: draftNote || (v.status === "published" ? undefined : `Restaurada da v${v.number}`) }, `Rascunho criado a partir da v${v.number}.`)}>{v.status === "published" ? "Criar rascunho" : "Restaurar como rascunho"}</button> : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!published && !hasDraft ? <button type="button" className={`${s.btn} ${s.pri}`} style={{ marginTop: 10 }} disabled={busy || readOnly} onClick={() => run("createDraft", { trackId: track.id }, "Rascunho vazio criado.")}>Criar rascunho</button> : null}
                {!hasDraft ? <><label className={s.lab} htmlFor="dn">Nota do rascunho (opcional)</label><input id="dn" className={s.in} value={draftNote} maxLength={400} onChange={(e) => setDraftNote(e.target.value)} /></> : <p className={s.muted}>Já existe um rascunho nesta trilha (só um por vez).</p>}
              </div>
              {tree ? <VersionEditor key={tree.version.id} tree={tree} run={run} busy={busy} /> : <p className={s.muted}>Escolha uma versão para ver ou editar.</p>}
              <div className={s.card}>
                <h2>Histórico</h2>
                {track.history.length === 0 ? <p className={s.muted}>Sem registros ainda.</p> : <ul className={s.hist}>{track.history.map((h) => <li key={h.id}>{fmt(h.at)} · {ACTION_LABEL[h.action] || h.action}{h.versionNumber ? ` (v${h.versionNumber})` : ""}{h.by ? ` · ${h.by}` : ""}</li>)}</ul>}
              </div>
            </>
          )
        ) : null}
      </div>
    </div>
  );
}
