"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { coverImage, propertyCity } from "@/lib/format";

// Lista de imóveis do painel (admin/gestor). Card enxuto (dono, 2026-10-15): sem etiquetas no topo, sem
// "Construtora a confirmar"; só foto, nome, local/situação e o VALOR no canto direito. "Aprovar e publicar" pergunta
// se o site mostra o imóvel com ou sem os valores (hidePrice — o site público some com preço/entrada).
// Botões pequenos do rodapé do card (dono, 2026-10-15: "bem menores").
// Visual novo (2026-10-22): botões de controle (36px visíveis, toque de 44px pelo ::before), cantos de 12px.
const SMALL_BTN = "relative inline-flex h-9 items-center rounded-control border bg-white px-3.5 text-[13px] font-bold transition-colors hover:bg-accent-soft before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']";

export default function AdminPropertyList({ properties }) {
  const router = useRouter();
  const [publishTarget, setPublishTarget] = useState(null);

  async function removeProperty(property) {
    if (!confirm(`Excluir "${property.name}"?`)) return;
    await fetch(`/api/properties/${property.id}`, { method: "DELETE" });
    router.refresh();
  }

  async function savePublication(property, patch) {
    const response = await fetch(`/api/properties/${property.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      alert(data.error || "Não foi possível atualizar a publicação.");
      return;
    }
    router.refresh();
  }

  async function unpublish(property) {
    if (!confirm(`Confirma reprovar (tirar do site) "${property.name}"?`)) return;
    await savePublication(property, { isPublished: false });
  }

  async function confirmPublish(withPrice) {
    const property = publishTarget;
    setPublishTarget(null);
    if (property) await savePublication(property, { isPublished: true, hidePrice: !withPrice });
  }

  return (
    // Blocos com foto (dono, 2026-10-22: "antes estava em blocos ... mais interessante"), como no protótipo do visual
    // novo: foto em cima com situação, código e valor; nome e local embaixo; mesmos botões de sempre no rodapé.
    <div className="container-page grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {properties.length ? properties.map((property) => {
        const place = propertyCity(property.location) || property.location || "";
        const situation = property.isPublished ? (property.hidePrice ? "No site, sem valores" : "No site") : "Em moderação";
        return (
          <article key={property.id} className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-white">
            <div className="relative aspect-[16/10] bg-mist">
              <Image src={coverImage(property)} alt={property.name} fill sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
              <span className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold text-white backdrop-blur ${property.isPublished ? "bg-[#0B5D3B]/85" : "bg-[#7A4B00]/85"}`}>{situation}</span>
              {property.code ? <span className="absolute right-2.5 top-2.5 rounded-full bg-[#07111F]/75 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">COD{property.code}</span> : null}
              <span className="absolute bottom-2.5 left-2.5 rounded-control bg-accent-strong px-3 py-1.5 text-[15px] font-extrabold text-on-accent shadow-float">{property.price || "Sem valor"}</span>
            </div>
            <div className="flex-1 px-4 pb-1 pt-3">
              <h2 className="text-base font-extrabold leading-snug text-navy">{property.name}</h2>
              {place ? <p className="mt-0.5 text-sm text-muted">{place}</p> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line px-4 py-3">
              {property.isPublished ? (
                <Link className={`${SMALL_BTN} border-line text-navy`} href={`/empreendimentos/${property.id}`}>Abrir</Link>
              ) : null}
              <Link className={`${SMALL_BTN} border-line text-navy`} href={`/admin/empreendimentos/${property.id}`}>Editar</Link>
              {/* Regras de entrada só existem para empreendimento (dono, 2026-10-15). */}
              {property.isDevelopment ? <Link className={`${SMALL_BTN} border-line text-navy`} href={`/admin/empreendimentos/${property.id}?aba=regras`}>Regras de entrada</Link> : null}
              {property.isPublished ? (
                <button type="button" className={`${SMALL_BTN} border-warning-line text-warning`} onClick={() => unpublish(property)}>
                  Reprovar (tirar do site)
                </button>
              ) : (
                <button type="button" className={`${SMALL_BTN} border-success-line text-success`} onClick={() => setPublishTarget(property)}>
                  Aprovar e publicar
                </button>
              )}
              <button type="button" className={`${SMALL_BTN} border-danger-line text-danger`} onClick={() => removeProperty(property)}>
                Excluir
              </button>
            </div>
          </article>
        );
      }) : (
        <div className="col-span-full rounded-2xl border border-line bg-white p-12 text-center shadow-soft">
          <h2 className="text-2xl font-extrabold text-navy">Nenhum empreendimento cadastrado</h2>
          <p className="mt-3 text-muted">Comece adicionando o primeiro imóvel ao portfólio.</p>
        </div>
      )}
      <PublishDialog property={publishTarget} onCancel={() => setPublishTarget(null)} onConfirm={confirmPublish} />
    </div>
  );
}

function PublishDialog({ property, onCancel, onConfirm }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (property && !dialog.open) dialog.showModal();
    if (!property && dialog.open) dialog.close();
  }, [property]);

  return (
    <dialog ref={ref} aria-labelledby={titleId} className="ui-confirm" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      {property ? (
        <div className="p-5 sm:p-6">
          <h2 id={titleId} className="text-base font-semibold text-ink">Publicar no site</h2>
          <p className="mt-1 text-sm text-ink-2">
            Como &quot;{property.name}&quot; deve aparecer no site?{property.price ? ` Valor cadastrado: ${property.price}.` : ""}
          </p>
          <div className="mt-5 grid gap-2">
            <button type="button" className="premium-button-primary w-full" onClick={() => onConfirm(true)}>Publicar com valores</button>
            <button type="button" className="premium-button-secondary w-full" onClick={() => onConfirm(false)}>Publicar sem valores</button>
            <button type="button" className="mt-1 text-sm font-bold text-muted hover:text-navy" onClick={onCancel}>Cancelar</button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
