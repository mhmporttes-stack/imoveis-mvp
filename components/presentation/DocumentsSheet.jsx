"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { DOCUMENTS_SCENE_TEXT } from "@/lib/simulation-presentation-documents.mjs";
import styles from "./presentation.module.css";

// Folha "Lista de documentos": abre sobre a cena final, rolável, com botão de fechar. Mostra a lista FINAL que veio no DTO
// (`items`: títulos e descrições já resolvidos no servidor, personalizados pelo cadastro) — a mesma da imagem para baixar.
// Este componente nunca vê dado cru do cadastro.
export default function DocumentsSheet({ items = [], onClose }) {
  const closeRef = useRef(null);

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

  return (
    <div className={styles.sheetBackdrop} data-no-nav="" data-sheet="" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="doc-sheet-title">
        <header className={styles.sheetHead}>
          <h2 id="doc-sheet-title" className={styles.sheetTitle}>Lista de documentos</h2>
          <button ref={closeRef} type="button" className={styles.sheetClose} onClick={onClose} aria-label="Fechar a lista de documentos">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className={styles.sheetBody} tabIndex={0}>
          <p className={styles.sheetIntro}>{DOCUMENTS_SCENE_TEXT}</p>
          <ul className={styles.docList}>
            {items.map((item) => (
              <li key={item.id} className={styles.docItem}>
                <span className={styles.docCheck} aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M5.5 12.5 L10 17 L18.5 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <div className={styles.docText}>
                  <h3 className={styles.docTitle}>{item.title}</h3>
                  {item.description ? <p className={styles.docDesc}>{item.description}</p> : null}
                  {item.obs ? <p className={styles.docObs}>{item.obs}</p> : null}
                  {item.lines?.length ? (
                    <ul className={styles.docLines}>
                      {item.lines.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
