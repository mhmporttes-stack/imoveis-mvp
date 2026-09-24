"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, LoaderCircle, RefreshCw, Save } from "lucide-react";
import Avatar from "@/components/Avatar";

// Limites da Meta (espelham lib/whatsapp-profile.js).
const LIMITS = { about: 139, description: 512, address: 256, email: 128 };

const VERTICALS = [
  ["UNDEFINED", "Não definido"],
  ["PROF_SERVICES", "Serviços profissionais"],
  ["RETAIL", "Varejo"],
  ["FINANCE", "Finanças"],
  ["EDU", "Educação"],
  ["HEALTH", "Saúde"],
  ["EVENT_PLAN", "Eventos"],
  ["HOTEL", "Hotelaria"],
  ["TRAVEL", "Viagens"],
  ["AUTO", "Automotivo"],
  ["BEAUTY", "Beleza e estética"],
  ["APPAREL", "Moda"],
  ["ENTERTAIN", "Entretenimento"],
  ["GROCERY", "Mercado"],
  ["RESTAURANT", "Restaurante"],
  ["GOVT", "Governo"],
  ["NONPROFIT", "Sem fins lucrativos"],
  ["OTHER", "Outro"]
];

const NAME_STATUS_LABELS = {
  APPROVED: "Nome aprovado pela Meta",
  AVAILABLE_WITHOUT_REVIEW: "Nome disponível",
  PENDING_REVIEW: "Nome em análise pela Meta",
  DECLINED: "Nome recusado pela Meta",
  EXPIRED: "Nome expirado"
};

function toForm(profile) {
  return {
    about: profile.about || "",
    description: profile.description || "",
    address: profile.address || "",
    email: profile.email || "",
    vertical: profile.vertical || "UNDEFINED",
    site1: profile.websites?.[0] || "",
    site2: profile.websites?.[1] || ""
  };
}

// Recorta o centro da imagem em quadrado e reduz para 640x640 JPEG: é o
// formato que a Meta pede para a foto de perfil e mantém o arquivo pequeno
// (o envio passa pela Vercel, que limita o corpo da requisição).
async function prepareProfilePhoto(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 640;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 640, 640);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 640, 640);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Não foi possível preparar a imagem.");
  return blob;
}

export default function WhatsappProfileEditor() {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-master/profile", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar o perfil.");
      setProfile(data.profile);
      setForm(toForm(data.profile));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage("");
  }

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-master/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          about: form.about,
          description: form.description,
          address: form.address,
          email: form.email,
          vertical: form.vertical,
          websites: [form.site1, form.site2].filter((site) => site.trim())
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar o perfil.");
      setProfile(data.profile);
      setForm(toForm(data.profile));
      setMessage("Perfil atualizado no WhatsApp.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function changePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setMessage("");
    setError("");
    try {
      const blob = await prepareProfilePhoto(file);
      const body = new FormData();
      body.append("file", new File([blob], "perfil.jpg", { type: "image/jpeg" }));
      const response = await fetch("/api/admin/whatsapp-master/profile/photo", { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível atualizar a foto.");
      setProfile(data.profile);
      setMessage("Foto atualizada. Pode levar alguns instantes para aparecer no WhatsApp dos clientes.");
    } catch (photoError) {
      setError(photoError.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="container-page mt-6 rounded-[28px] border border-line bg-white p-6 shadow-soft">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-navy">Perfil do WhatsApp</h2>
          <p className="mt-1 text-sm font-semibold text-muted">O que o cliente vê ao tocar no nome da empresa na conversa.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="premium-button-secondary">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Recarregar
        </button>
      </div>

      {loading && !form ? (
        <p className="flex items-center gap-2 font-bold text-muted"><LoaderCircle className="h-5 w-5 animate-spin" /> Carregando perfil…</p>
      ) : null}
      {!form && error ? <p className="rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}

      {form ? (
        <>
          <div className="flex flex-wrap items-center gap-5">
            <div className="relative">
              <Avatar name={profile?.displayName || "WhatsApp"} photoUrl={profile?.pictureUrl} size={96} />
              {uploading ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-white/70">
                  <LoaderCircle className="h-6 w-6 animate-spin text-navy" />
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={changePhoto} />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="premium-button-primary">
                <Camera className="h-5 w-5" />
                {uploading ? "Enviando…" : "Trocar foto"}
              </button>
              <p className="text-xs font-semibold text-muted">A imagem é recortada em quadrado e reduzida para 640×640 automaticamente.</p>
            </div>
          </div>

          <dl className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-line p-4">
              <dt className="text-sm font-black text-muted">Nome de exibição</dt>
              <dd className="mt-1 font-black text-navy">{profile?.displayName || "—"}</dd>
              <p className="mt-1 text-xs font-semibold text-muted">
                {NAME_STATUS_LABELS[profile?.nameStatus] || ""}{profile?.nameStatus ? " · " : ""}
                O nome só pode ser alterado no Gerenciador do WhatsApp da Meta (passa por análise) — não dá para mudar por aqui.
              </p>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <dt className="text-sm font-black text-muted">Número</dt>
              <dd className="mt-1 font-black text-navy">{profile?.displayPhone || "—"}</dd>
            </div>
          </dl>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Recado (Info)" hint={`${form.about.length}/${LIMITS.about}`} className="md:col-span-2">
              <input value={form.about} maxLength={LIMITS.about} onChange={(event) => setField("about", event.target.value)} className="w-full rounded-lg border border-line p-3 font-normal" />
            </Field>
            <Field label="Descrição da empresa" hint={`${form.description.length}/${LIMITS.description}`} className="md:col-span-2">
              <textarea value={form.description} maxLength={LIMITS.description} rows={4} onChange={(event) => setField("description", event.target.value)} className="w-full rounded-lg border border-line p-3 font-normal" />
            </Field>
            <Field label="Endereço" hint={`${form.address.length}/${LIMITS.address}`}>
              <input value={form.address} maxLength={LIMITS.address} onChange={(event) => setField("address", event.target.value)} className="w-full rounded-lg border border-line p-3 font-normal" />
            </Field>
            <Field label="E-mail">
              <input type="email" value={form.email} maxLength={LIMITS.email} onChange={(event) => setField("email", event.target.value)} className="w-full rounded-lg border border-line p-3 font-normal" />
            </Field>
            <Field label="Categoria">
              <select value={form.vertical} onChange={(event) => setField("vertical", event.target.value)} className="w-full rounded-lg border border-line p-3 font-normal">
                {VERTICALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Site 1">
              <input value={form.site1} placeholder="https://" onChange={(event) => setField("site1", event.target.value)} className="w-full rounded-lg border border-line p-3 font-normal" />
            </Field>
            <Field label="Site 2">
              <input value={form.site2} placeholder="https://" onChange={(event) => setField("site2", event.target.value)} className="w-full rounded-lg border border-line p-3 font-normal" />
            </Field>
          </div>

          {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 font-bold text-emerald-800">{message}</p> : null}
          {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}

          <div className="mt-6">
            <button type="button" onClick={save} disabled={saving} className="premium-button-primary">
              {saving ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
              {saving ? "Salvando…" : "Salvar perfil"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Field({ label, hint, className = "", children }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 flex items-center justify-between text-sm font-black text-navy">
        {label}
        {hint ? <span className="text-xs font-bold text-muted">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
