import { randomUUID } from "node:crypto";

export const PROPERTY_TYPES = ["casa", "apartamento", "loteamento", "condominio"];

export function rowToProperty(row) {
  return {
    id: row.id,
    name: row.name,
    builder: row.builder,
    location: row.location,
    type: row.type,
    price: row.price,
    terms: row.terms,
    discounts: row.discounts,
    installmentEntry: row.installment_entry,
    delivery: row.delivery,
    area: row.area,
    bedrooms: row.bedrooms,
    photos: normalizePhotos(row.photos_json),
    pdfName: row.pdf_name,
    pdfData: row.pdf_data,
    builderUrl: row.builder_url,
    whatsapp: row.whatsapp,
    instagram: row.instagram,
    internalNotes: row.internal_notes,
    salesText: row.sales_text,
    isPublished: row.is_published ?? true,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function toPropertyRecord(property, now = new Date().toISOString()) {
  return {
    id: property.id || randomUUID(),
    name: text(property.name) || "Empreendimento sem nome",
    builder: text(property.builder),
    location: text(property.location),
    type: PROPERTY_TYPES.includes(property.type) ? property.type : "apartamento",
    price: text(property.price),
    terms: text(property.terms),
    discounts: text(property.discounts),
    installment_entry: text(property.installmentEntry),
    delivery: text(property.delivery),
    area: text(property.area),
    bedrooms: text(property.bedrooms),
    photos_json: Array.isArray(property.photos) ? property.photos : [],
    pdf_name: text(property.pdfName),
    pdf_data: text(property.pdfData),
    builder_url: text(property.builderUrl),
    whatsapp: text(property.whatsapp),
    instagram: text(property.instagram),
    internal_notes: text(property.internalNotes),
    sales_text: text(property.salesText),
    is_published: property.isPublished === false ? false : true,
    created_at: property.createdAt || now,
    updated_at: now
  };
}

export function toSqliteParams(property, now = new Date().toISOString()) {
  const { is_published, ...record } = toPropertyRecord(property, now);
  return {
    ...record,
    photos_json: JSON.stringify(record.photos_json)
  };
}

function normalizePhotos(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
