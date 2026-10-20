"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, X } from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Field, { inputClasses } from "@/components/ui/Field";
import { MARKETPLACE_MAX_PHOTOS, STATUS_LABELS } from "@/lib/marketplace-core.mjs";
import { moveItem, useDragReorder } from "@/components/ui/useDragReorder";
import { compressForUpload, uploadPhoto } from "@/components/image-upload";

// Publicador do Facebook Marketplace (MKT-1). Toda regra (aprovação, fila, limites) fica no servidor
// (lib/marketplace-core.mjs); a tela só mostra e chama /api/admin/marketplace/**.

const STATUS_TONES = { pending: "warning", claimed: "info", published: "success", failed: "danger", cancelled: "neutral" };
const OFFER_LABELS = { sale: "Venda", rent: "Aluguel" };
const TYPE_LABELS = { house: "Casa", apartment: "Apartamento", townhouse: "Casa em condomínio / sobrado", land: "Terreno" };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

const EMPTY_FORM = {
  propertyId: "",
  title: "",
  price: "",
  description: "",
  offerType: "sale",
  propertyType: "house",
  bedrooms: "",
  bathrooms: 1,
  areaM2: "",
  iptu: "",
  condoFee: "",
  parkingSpaces: "",
  city: "Marília",
  state: "SP",
  neighborhood: "",
  photoUrls: []
};

function fromListing(listing) {
  return {
    propertyId: listing.property_id || "",
    title: listing.title || "",
    price: listing.price ?? "",
    description: listing.description || "",
    offerType: listing.offer_type,
    propertyType: listing.property_type,
    bedrooms: listing.bedrooms ?? "",
    bathrooms: listing.bathrooms ?? 1,
    areaM2: listing.area_m2 ?? "",
    iptu: listing.iptu ?? "",
    condoFee: listing.condo_fee ?? "",
    parkingSpaces: listing.parking_spaces ?? "",
    city: listing.city || "Marília",
    state: listing.state || "SP",
    neighborhood: listing.neighborhood || "",
    photoUrls: Array.isArray(listing.photo_urls) ? listing.photo_urls : []
  };
}

async function callApi(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a ação.");
  return data;
}

function formatDate(value) {
  return value ? dateTime.format(new Date(value)) : "—";
}

export default function MarketplaceAdmin({ initialListings = [], ready = true, initialPublisher = {}, properties = [] }) {
  const [listings, setListings] = useState(initialListings);
  const [publisher, setPublisher] = useState(initialPublisher);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [photoStatus, setPhotoStatus] = useState("");
  const drag = useDragReorder((from, to) => setForm((current) => ({ ...current, photoUrls: moveItem(current.photoUrls, from, to) })));

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setPhotoStatus("");
    setEditingId("");
  }

  async function refresh() {
    const data = await callApi("/api/admin/marketplace");
    setListings(data.listings || []);
    setPublisher(data.publisher || {});
  }

  async function run(label, task) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (taskError) {
      setError(taskError.message);
    } finally {
      setBusy("");
    }
  }

  function loadFromProperty(propertyId) {
    setField("propertyId", propertyId);
    if (!propertyId) return;
    run("draft", async () => {
      setPhotoStatus("Trazendo as fotos do imóvel…");
      const { draft, photoProblems = [] } = await callApi(`/api/admin/marketplace/draft?propertyId=${encodeURIComponent(propertyId)}`);
      setForm({ ...EMPTY_FORM, ...draft });
      setPhotoStatus("");
      if (!draft.totalPhotos) setError("Este imóvel não tem nenhuma foto cadastrada. Adicione as fotos abaixo em “Adicionar fotos”.");
      else if (photoProblems.length) setError(`${photoProblems.length} foto(s) não puderam ser trazidas (${photoProblems.join("; ")}). Adicione de novo pelo botão “Adicionar fotos”, se quiser.`);
      else setMessage(`${draft.photoUrls.length} foto(s) do imóvel carregadas.`);
    });
  }

  function save(event) {
    event.preventDefault();
    if (!form.photoUrls.length) {
      setError("Inclua pelo menos 1 foto (botão “Adicionar fotos”).");
      return;
    }
    const payload = form;
    run("save", async () => {
      if (editingId) await callApi(`/api/admin/marketplace/${editingId}`, { method: "PATCH", body: JSON.stringify({ listing: payload }) });
      else await callApi("/api/admin/marketplace", { method: "POST", body: JSON.stringify(payload) });
      resetForm();
      await refresh();
      setMessage("Anúncio salvo. Ele só vai para o Facebook depois de você tocar em “Aprovado — publicar no Marketplace”.");
    });
  }

  function act(listing, action) {
    const approveText = listing.status === "failed"
      ? `Tentar publicar “${listing.title}” de novo? Antes, confira em “Seus classificados” no Facebook que ele não saiu (para não duplicar). A extensão vai publicar sozinha no seu perfil.`
      : `Aprovar a publicação de “${listing.title}” no Facebook Marketplace? A extensão vai publicar sozinha no seu perfil.`;
    if (action === "approve" && !window.confirm(approveText)) return;
    if (action === "cancel" && !window.confirm(`Cancelar “${listing.title}”?`)) return;
    let url = "";
    if (action === "mark_published") {
      url = window.prompt(`Cole o link do anúncio “${listing.title}” no Facebook (https://www.facebook.com/marketplace/item/...). A extensão não vai mais tentar publicar este anúncio.`) || "";
      if (!url.trim()) return;
    }
    run(`${action}:${listing.id}`, async () => {
      await callApi(`/api/admin/marketplace/${listing.id}`, { method: "PATCH", body: JSON.stringify({ action, url }) });
      await refresh();
    });
  }

  function edit(listing) {
    setEditingId(listing.id);
    setForm(fromListing(listing));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function addPhotos(fileList) {
    const room = MARKETPLACE_MAX_PHOTOS - form.photoUrls.length;
    const files = [...(fileList || [])].filter((file) => file.type?.startsWith("image/")).slice(0, Math.max(0, room));
    if (!files.length) {
      if (room <= 0) setError(`No máximo ${MARKETPLACE_MAX_PHOTOS} fotos.`);
      return;
    }
    setBusy("photos");
    setError("");
    try {
      for (const [index, file] of files.entries()) {
        setPhotoStatus(`Enviando foto ${index + 1} de ${files.length}…`);
        const optimized = await compressForUpload(file);
        const uploaded = await uploadPhoto(optimized.blob, optimized.name, "marketplace");
        setForm((current) => ({ ...current, photoUrls: [...current.photoUrls, uploaded.data].slice(0, MARKETPLACE_MAX_PHOTOS) }));
      }
      setPhotoStatus("");
    } catch (uploadError) {
      setPhotoStatus("");
      setError(uploadError.message);
    } finally {
      setBusy("");
    }
  }

  function movePhoto(from, to) {
    setForm((current) => ({ ...current, photoUrls: moveItem(current.photoUrls, from, to) }));
  }

  function removePhoto(index) {
    setForm((current) => ({ ...current, photoUrls: current.photoUrls.filter((_, position) => position !== index) }));
  }

  function generateToken() {
    if (publisher.tokenConfigured && !window.confirm("Gerar uma chave nova desliga a chave atual da extensão. Continuar?")) return;
    run("token", async () => {
      const data = await callApi("/api/admin/marketplace/token", { method: "POST", body: "{}" });
      setToken(data.token);
      await refresh();
    });
  }

  return (
    <section className="container-page space-y-6">
      <header className="space-y-1">
        <h1 className="text-[28px] font-semibold text-navy">Facebook Marketplace</h1>
        <p className="text-sm text-muted">
          A extensão do Chrome no seu computador publica sozinha, no seu perfil do Facebook, só os anúncios que você aprovar aqui
          (até 3 por dia, um de cada vez). Editar um anúncio tira a aprovação.
        </p>
      </header>

      {!ready ? (
        <Card className="border-warning-line bg-warning-soft text-sm text-warning">A tabela do Marketplace ainda não foi criada no banco (migration 20261020120000).</Card>
      ) : null}
      {error ? <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      {message ? <p className="rounded-control bg-info-soft px-3 py-2 text-sm text-info">{message}</p> : null}

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold text-navy">Chave da extensão</h2>
        <p className="text-sm text-muted">
          {publisher.tokenConfigured ? `Chave criada em ${formatDate(publisher.tokenCreatedAt)}. Extensão vista por último: ${formatDate(publisher.lastSeenAt)}.` : "Nenhuma chave criada ainda."}
        </p>
        {token ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Copie agora e cole nas opções da extensão — ela não aparece de novo:</p>
            <input readOnly value={token} className={inputClasses} onFocus={(event) => event.target.select()} />
          </div>
        ) : null}
        <Button variant="secondary" onClick={generateToken} loading={busy === "token"}>{publisher.tokenConfigured ? "Gerar chave nova" : "Gerar chave"}</Button>
      </Card>

      <Card as="form" onSubmit={save} className="space-y-4">
        <h2 className="text-lg font-semibold text-navy">{editingId ? "Editar anúncio" : "Novo anúncio"}</h2>
        <Field label="Preencher a partir do imóvel/empreendimento do CRM" hint="Traz fotos, preço e descrição com o seu link de simulação.">
          <select className={inputClasses} value={form.propertyId} onChange={(event) => loadFromProperty(event.target.value)} disabled={busy === "draft"}>
            <option value="">— Escolher —</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>{property.name}{property.isDevelopment ? " (empreendimento)" : ""}</option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Título (só no CRM)" hint="O Facebook monta o título do classificado pelos dados do imóvel." required><input className={inputClasses} value={form.title} maxLength={100} onChange={(event) => setField("title", event.target.value)} /></Field>
          <Field label="Preço (R$)" required><input className={inputClasses} inputMode="decimal" value={form.price} onChange={(event) => setField("price", event.target.value)} /></Field>
          <Field label="Venda ou aluguel">
            <select className={inputClasses} value={form.offerType} onChange={(event) => setField("offerType", event.target.value)}>
              {Object.entries(OFFER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Tipo do imóvel">
            <select className={inputClasses} value={form.propertyType} onChange={(event) => setField("propertyType", event.target.value)}>
              {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Quartos" hint="O Facebook só deixa avançar com quartos e banheiros."><input className={inputClasses} inputMode="numeric" value={form.bedrooms} onChange={(event) => setField("bedrooms", event.target.value)} /></Field>
          <Field label="Banheiros" required><input className={inputClasses} inputMode="numeric" value={form.bathrooms} onChange={(event) => setField("bathrooms", event.target.value)} /></Field>
          <Field label="Área (m²)"><input className={inputClasses} inputMode="decimal" value={form.areaM2} onChange={(event) => setField("areaM2", event.target.value)} /></Field>
          <Field label="IPTU (R$, opcional)"><input className={inputClasses} inputMode="decimal" value={form.iptu} onChange={(event) => setField("iptu", event.target.value)} /></Field>
          <Field label="Condomínio (R$, opcional)"><input className={inputClasses} inputMode="decimal" value={form.condoFee} onChange={(event) => setField("condoFee", event.target.value)} /></Field>
          <Field label="Vagas de estacionamento (opcional)"><input className={inputClasses} inputMode="numeric" value={form.parkingSpaces} onChange={(event) => setField("parkingSpaces", event.target.value)} /></Field>
          <Field label="Bairro" hint="A extensão procura “bairro, Marília” na localização do Facebook."><input className={inputClasses} value={form.neighborhood} onChange={(event) => setField("neighborhood", event.target.value)} /></Field>
          <Field label="Cidade"><input className={inputClasses} value={form.city} onChange={(event) => setField("city", event.target.value)} /></Field>
          <Field label="UF"><input className={inputClasses} value={form.state} maxLength={2} onChange={(event) => setField("state", event.target.value)} /></Field>
        </div>
        <Field label="Descrição"><textarea className={`${inputClasses} min-h-40 py-2`} value={form.description} onChange={(event) => setField("description", event.target.value)} /></Field>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">Fotos <span className="text-muted">({form.photoUrls.length}/{MARKETPLACE_MAX_PHOTOS}) — a primeira é a capa; arraste ou use as setas para ordenar</span></p>
            <label className={`inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-control border border-navy/15 bg-white px-4 text-sm font-semibold text-navy hover:border-brand/40 hover:bg-info-soft ${busy === "photos" || form.photoUrls.length >= MARKETPLACE_MAX_PHOTOS ? "pointer-events-none opacity-50" : ""}`}>
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              Adicionar fotos
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(event) => { addPhotos(event.target.files); event.target.value = ""; }} />
            </label>
          </div>
          {photoStatus ? <p className="text-sm text-info">{photoStatus}</p> : null}
          {form.photoUrls.length ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {form.photoUrls.map((url, index) => (
                <li key={`${url}-${index}`} {...drag.itemProps(index)} className={`overflow-hidden rounded-control border border-line bg-white ${drag.itemClass(index)}`}>
                  <div className="relative aspect-[4/3] bg-mist">
                    <img src={url} alt={`Foto ${index + 1}`} draggable={false} className="pointer-events-none h-full w-full object-cover" />
                    <span className="absolute left-2 top-2 rounded-chip bg-navy px-2 py-0.5 text-xs font-semibold text-white">{index === 0 ? "Capa" : index + 1}</span>
                  </div>
                  <div className="flex items-center justify-between gap-1 p-1">
                    <Button size="icon" variant="ghost" aria-label={`Mover foto ${index + 1} para cima`} disabled={index === 0} onClick={() => movePhoto(index, index - 1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Mover foto ${index + 1} para baixo`} disabled={index === form.photoUrls.length - 1} onClick={() => movePhoto(index, index + 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="danger-ghost" aria-label={`Remover foto ${index + 1}`} onClick={() => removePhoto(index)}><X className="h-4 w-4" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-control border border-dashed border-line px-3 py-6 text-center text-sm text-muted">Nenhuma foto ainda. Escolha um imóvel acima ou toque em “Adicionar fotos”.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy === "save"} disabled={!ready || busy === "photos"}>{editingId ? "Salvar alterações" : "Salvar anúncio"}</Button>
          {editingId ? <Button variant="ghost" onClick={resetForm}>Cancelar edição</Button> : null}
        </div>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-navy">Anúncios</h2>
        {!listings.length ? <p className="text-sm text-muted">Nenhum anúncio ainda.</p> : null}
        {listings.map((listing) => {
          const approved = Boolean(listing.approved_at);
          const editable = ["pending", "failed"].includes(listing.status);
          return (
            <Card key={listing.id} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-navy">{listing.title}</p>
                  <p className="text-sm text-muted">{money.format(Number(listing.price))} · {OFFER_LABELS[listing.offer_type]} · {TYPE_LABELS[listing.property_type]} · {(listing.photo_urls || []).length} foto(s)</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={STATUS_TONES[listing.status]} dot>{STATUS_LABELS[listing.status]}</Badge>
                  {listing.status === "pending" ? <Badge tone={approved ? "success" : "neutral"}>{approved ? "Aprovado — na fila" : "Não aprovado"}</Badge> : null}
                </div>
              </div>
              <p className="text-xs text-muted">
                Criado {formatDate(listing.created_at)}
                {approved ? ` · aprovado ${formatDate(listing.approved_at)}` : ""}
                {listing.published_at ? ` · publicado ${formatDate(listing.published_at)}` : ""} · tentativas {listing.attempts}
              </p>
              {listing.marketplace_url ? <a className="text-sm font-medium text-brand underline" href={listing.marketplace_url} target="_blank" rel="noreferrer">Ver anúncio no Facebook</a> : null}
              {listing.error ? <p className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{listing.error}</p> : null}
              <div className="flex flex-wrap gap-2">
                {editable && !(listing.status === "pending" && approved) ? (
                  <Button size="sm" onClick={() => act(listing, "approve")} loading={busy === `approve:${listing.id}`}>{listing.status === "failed" ? "Tentar de novo" : "Aprovado — publicar no Marketplace"}</Button>
                ) : null}
                {listing.status === "pending" && approved ? (
                  <Button size="sm" variant="secondary" onClick={() => act(listing, "unapprove")} loading={busy === `unapprove:${listing.id}`}>Tirar aprovação</Button>
                ) : null}
                {["pending", "claimed", "failed"].includes(listing.status) ? (
                  <Button size="sm" variant="secondary" onClick={() => act(listing, "mark_published")} loading={busy === `mark_published:${listing.id}`}>Marcar como publicado manualmente</Button>
                ) : null}
                {editable ? <Button size="sm" variant="secondary" onClick={() => edit(listing)}>Editar</Button> : null}
                {editable ? <Button size="sm" variant="danger-ghost" onClick={() => act(listing, "cancel")} loading={busy === `cancel:${listing.id}`}>Cancelar</Button> : null}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
