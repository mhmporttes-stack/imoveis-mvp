import { randomUUID } from "node:crypto";
import { normalizeRegionValue } from "./property-filter-options";
import { normalizePropertyFeatures } from "./property-features";

export const PROPERTY_TYPES = ["casa", "apartamento", "loteamento", "condominio", "terreno", "chacara", "casa-condominio"];

export function rowToProperty(row) {
  return {
    id: row.id,
    name: row.name,
    builder: row.builder,
    location: row.location,
    region: row.region || "",
    status: row.status || "",
    type: row.type,
    price: row.price,
    terms: row.terms,
    discounts: row.discounts,
    installmentEntry: row.installment_entry,
    delivery: row.delivery,
    area: row.area,
    bedrooms: row.bedrooms,
    features: normalizeList(row.features_json),
    photos: normalizePhotos(row.photos_json),
    pdfName: row.pdf_name,
    pdfData: row.pdf_data,
    builderUrl: row.builder_url,
    whatsapp: row.whatsapp,
    instagram: row.instagram,
    internalNotes: row.internal_notes,
    salesText: row.sales_text,
    isPublished: booleanValue(row.is_published, true),
    isFeatured: booleanValue(row.is_featured, false),
    displayOrder: row.display_order ?? 0,
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
    region: normalizeRegionValue(property.region) || text(property.region),
    status: text(property.status),
    type: PROPERTY_TYPES.includes(property.type) ? property.type : "apartamento",
    price: text(property.price),
    terms: text(property.terms),
    discounts: text(property.discounts),
    installment_entry: text(property.installmentEntry),
    delivery: text(property.delivery),
    area: text(property.area),
    bedrooms: text(property.bedrooms),
    features_json: normalizePropertyFeatures(property.features),
    photos_json: Array.isArray(property.photos) ? property.photos : [],
    pdf_name: text(property.pdfName),
    pdf_data: text(property.pdfData),
    builder_url: text(property.builderUrl),
    whatsapp: text(property.whatsapp),
    instagram: text(property.instagram),
    internal_notes: text(property.internalNotes),
    sales_text: text(property.salesText),
    is_published: property.isPublished === false ? false : true,
    is_featured: property.isFeatured === true,
    display_order: Number.isFinite(Number(property.displayOrder)) ? Number(property.displayOrder) : 0,
    created_at: property.createdAt || now,
    updated_at: now
  };
}

export function toSqliteParams(property, now = new Date().toISOString()) {
  const { is_published, is_featured, display_order, ...record } = toPropertyRecord(property, now);
  return {
    ...record,
    is_published: is_published ? 1 : 0,
    is_featured: is_featured ? 1 : 0,
    display_order,
    features_json: JSON.stringify(record.features_json),
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

function normalizeList(value) {
  if (Array.isArray(value)) return normalizePropertyFeatures(value);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? normalizePropertyFeatures(parsed) : [];
  } catch {
    return [];
  }
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function booleanValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1;
}
