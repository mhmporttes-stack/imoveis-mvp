"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import Sheet from "./ui/Sheet";
import Button from "./ui/Button";

// Configuração da aba "Sem resposta" (WA-38, dono 2026-10-30) — admin geral e gestor; vale para o Chat do WhatsApp e o
// do Marketplace. Uma frase por linha. A barreira real é a rota (requireBrokerManagementApi); o botão só aparece para eles.
export default function ChatClosingPhrasesButton({ onSaved = () => {} }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState("");
  const [negative, setNegative] = useState("");
  const [defaults, setDefaults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function apply(settings) {
    setClosing((settings.closing || []).join("\n"));
    setNegative((settings.negative || []).join("\n"));
    setDefaults(settings.defaults || null);
  }

  async function openSheet() {
    setOpen(true);
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const response = await fetch("/api/admin/chat-closing-phrases", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar a lista.");
      apply(data.settings);
      if (data.settings?.ready === false) setNotice("Usando a lista padrão. Para salvar mudanças, falta aplicar a migration 20261030170000 no banco.");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setLoading(false);
    }
  }

  async function save(body) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/chat-closing-phrases", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar a lista.");
      apply(data.settings);
      setNotice("Lista salva. A aba atualiza em até 1 minuto.");
      onSaved();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  const textareaClass = "min-h-40 w-full rounded-control border border-line bg-white p-3 text-sm font-semibold text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand/10";

  return (
    <>
      <button type="button" onClick={openSheet} title="Configurar a aba Sem resposta" aria-label="Configurar a aba Sem resposta"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-white text-[#54656F] transition hover:border-brand hover:text-brand">
        <Settings2 className="h-4 w-4" aria-hidden="true" />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Aba “Sem resposta”"
        description="Quando a última mensagem do cliente for uma destas, a conversa sai da aba (só da aba — nada é enviado e o status do cliente não muda). Se ele escrever outra coisa, volta. Vale para o Chat do WhatsApp e o do Marketplace."
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            {defaults ? <Button variant="ghost" size="sm" disabled={saving || loading} onClick={() => save({ reset: true })}>Voltar ao padrão</Button> : null}
            <Button size="sm" loading={saving} disabled={loading} onClick={() => save({ closing: closing.split("\n"), negative: negative.split("\n") })}>Salvar</Button>
          </div>
        )}
      >
        <div className="space-y-4">
          {error ? <p role="alert" className="rounded-control border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p> : null}
          {notice ? <p role="status" className="rounded-control border border-line bg-mist px-3 py-2 text-sm font-bold text-ink">{notice}</p> : null}
          <label className="block space-y-1.5">
            <span className="block text-sm font-extrabold text-ink">Encerramentos (a mensagem inteira)</span>
            <span className="block text-xs font-semibold text-muted">Uma por linha. Combinações também contam (“ok, obrigado”) e cumprimentos em volta (“boa tarde, obrigada”). Mensagem só com emoji sai sempre. Qualquer “?” mantém a conversa na aba.</span>
            <textarea className={textareaClass} value={closing} disabled={loading} onChange={(event) => setClosing(event.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-extrabold text-ink">Negativas (frase dentro de uma mensagem curta)</span>
            <span className="block text-xs font-semibold text-muted">Uma por linha. Ex.: “não tenho interesse” tira também “bom dia, no momento não tenho interesse”. Acentos, maiúsculas e pontuação não importam.</span>
            <textarea className={textareaClass} value={negative} disabled={loading} onChange={(event) => setNegative(event.target.value)} />
          </label>
        </div>
      </Sheet>
    </>
  );
}
