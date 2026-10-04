"use client";

import s from "./academia.module.css";

// Região viva educada, DENTRO do shell. `message` vazio = escondido.
export default function AcademiaToast({ message }) {
  return (
    <div className={`${s.toast} ${message ? s.on : ""}`}>{message}</div>
  );
}
