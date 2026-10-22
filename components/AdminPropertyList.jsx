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
    <div className="container-page grid gap-4">
      {properties.length ? properties.map((property) => {
        const place = propertyCity(property.location) || property.location || "";
        const situation = property.isPublished ? (property.hidePrice ? "No site, sem valores" : "No site") : "Em moderação";
        return (
          <article key={property.id} className="min-w-0 rounded-2xl border border-line bg-white p-4 shadow-soft">
            <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[120px_minmax(0,1fr)_auto]">
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-mist">
                <Image src={coverImage(property)} alt={property.name} fill className="object-cover" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-extrabold leading-snug text-navy sm:text-xl">{property.name}</h2>
                <p className="mt-1 text-sm text-muted">
                  {property.code ? <span className="font-bold text-navy">COD{property.code} · </span> : null}
                  {place ? `${place} · ` : ""}
                  <span className={property.isPublished ? "font-bold text-success" : "font-bold text-warning"}>{situation}</span>
                </p>
                <p className="mt-1 text-base font-extrabold text-navy sm:hidden">{property.price || "Sem valor"}</p>
              </div>
              <p className="hidden self-start text-right text-lg font-extrabold text-navy sm:block">{property.price || "Sem valor"}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
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
        <div className="rounded-2xl border border-line bg-white p-12 text-center shadow-soft">
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
