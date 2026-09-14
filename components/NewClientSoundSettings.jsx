"use client";

import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { isNewClientSoundEnabled, playNewClientSound, setNewClientSoundEnabled } from "@/lib/new-client-sound";

// Controle vive em Gestão > Automações (não é uma tela própria) porque o
// alerta está diretamente ligado ao gatilho "Cliente se cadastrou pelo
// formulário" (client_form_submitted) — nunca a "Corretor adicionou cliente".
// A preferência Ativado/Desativado é por dispositivo/navegador E por usuário
// (localStorage namespaced por userId, ver lib/new-client-sound.js) — num
// computador compartilhado, cada login mantém o próprio Ativado/Desativado.
export default function NewClientSoundSettings({ userId }) {
  const [enabled, setEnabled] = useState(false);
  const [testStatus, setTestStatus] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setEnabled(isNewClientSoundEnabled(userId));
  }, [userId]);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setNewClientSoundEnabled(userId, next);
  }

  async function testSound() {
    setTesting(true);
    setTestStatus(null);
    try {
      await playNewClientSound();
      setTestStatus({ ok: true, message: "Alerta sonoro ativado neste dispositivo." });
    } catch (error) {
      setTestStatus({ ok: false, message: error.message || "O navegador bloqueou o áudio. Clique novamente ou verifique as permissões do navegador." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-white p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-brand">
            <Volume2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-black uppercase tracking-[0.1em] text-navy">Alerta sonoro de novo cliente</h3>
            <p className="mt-1 max-w-md text-sm text-muted">Toca um alerta no navegador quando um novo cliente entra pelo formulário. Corretor cadastrado manualmente não gera som.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-pressed={enabled}
            className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-black transition ${
              enabled ? "border-brand bg-blue-50 text-brand" : "border-line bg-white text-muted"
            }`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${enabled ? "bg-brand" : "bg-muted"}`} aria-hidden="true" />
            {enabled ? "Ativado" : "Desativado"}
          </button>
          <button type="button" onClick={testSound} disabled={testing} className="premium-button-secondary h-10 disabled:cursor-not-allowed disabled:opacity-60">
            {testing ? "Testando..." : "Testar som"}
          </button>
        </div>
      </div>
      {testStatus ? (
        <p className={`mt-3 text-sm font-bold ${testStatus.ok ? "text-emerald-700" : "text-red-700"}`}>{testStatus.message}</p>
      ) : null}
    </section>
  );
}
