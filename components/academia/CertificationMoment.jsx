"use client";

import s from "./academia.module.css";

const fmt = (iso) => {
  try { return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }); } catch { return ""; }
};

// Certificação: câmera ao topo, noite, coroa visível acima de um cartão compacto com o selo (logo oficial),
// nome, "18 de 18 aulas · data" e ações. Código e PDF reais quando a matrícula concluiu (F5).
export default function CertificationMoment({ cert, total, on, show, onDownload, onBack, headingRef }) {
  return (
    <section className={`${s.mom} ${s.onDark} ${on ? s.on : ""} ${show ? s.show : ""}`} aria-labelledby="acd-certH" inert={!on}>
      <div className={s.cert}>
        <div className={s.card}>
          <span className={s.fr} /><span className={s.fr2} />
          <img className={s.seal} src="/icons/icon-192-mm.png" width="60" height="60" alt="Selo Matheus Machado" />
          <p className={s.k}>Certificado de conclusão</p>
          <h2 className={s.who} id="acd-certH" tabIndex={-1} ref={headingRef}>{cert.holderName || "Aluno"}</h2>
          <p className={s.s}>concluiu a {cert.trackTitle} da Academia Matheus Machado</p>
          <p className={s.m}>{total} de {total} aulas{cert.completedAt ? ` · ${fmt(cert.completedAt)}` : ""}{cert.isSample ? " · exemplo" : ""}</p>
          {cert.code ? <p className={s.m}>Código {cert.code}</p> : null}
        </div>
        <div className={s.certActs}>
          {cert.downloadUrl
            ? <a className={`${s.btn} ${s.lite}`} href={cert.downloadUrl} download>Baixar certificado (PDF)</a>
            : <button type="button" className={`${s.btn} ${s.lite}`} onClick={onDownload}>Baixar certificado</button>}
          <button type="button" className={`${s.btn} ${s.alt}`} onClick={onBack}>Evolução</button>
        </div>
      </div>
    </section>
  );
}
