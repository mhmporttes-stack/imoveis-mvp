"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import {
  DOCUMENTS_EXTRA_NOTE,
  DOCUMENTS_SCENE_TEXT,
  PRESENTATION_DOCUMENT_GROUPS
} from "@/lib/simulation-presentation-documents.mjs";
import styles from "./presentation.module.css";

// Folha "Lista de documentos": abre sobre a cena final, rolável, com botão de fechar. Mostra a lista BASE
// (lib/simulation-presentation-documents.mjs) — a mesma da imagem para baixar. Não usa nenhum dado do cliente.
export default function DocumentsSheet({ onClose }) {
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
          {PRESENTATION_DOCUMENT_GROUPS.map((group) => (
            <div key={group.id} className={styles.sheetGroup}>
              <h3 className={styles.sheetGroupTitle}>{group.title}</h3>
              <ul className={styles.sheetList}>
                {group.items.map((item) => <li key={item.id}>{item.text}</li>)}
              </ul>
            </div>
          ))}
          <p className={styles.sheetNote}>{DOCUMENTS_EXTRA_NOTE}</p>
        </div>
      </section>
    </div>
  );
}
