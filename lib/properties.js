import { randomUUID } from "node:crypto";
import { canUseLocalDatabase } from "./runtime";
import { getDb } from "./db";
import { getPublicProperty, listPublicProperties } from "./public-properties";

const TYPES = ["casa", "apartamento", "loteamento", "condominio"];

export function listProperties() {
  if (!canUseLocalDatabase) return listPublicProperties();
  seedIfEmpty();
  return getDb()
    .prepare("SELECT * FROM properties ORDER BY datetime(created_at) DESC")
    .all()
    .map(rowToProperty);
}

export function getProperty(id) {
  if (!canUseLocalDatabase) return getPublicProperty(id);
  seedIfEmpty();
  const row = getDb().prepare("SELECT * FROM properties WHERE id = ?").get(id);
  return row ? rowToProperty(row) : null;
}

export function createProperty(property) {
  if (!canUseLocalDatabase) {
    throw new Error("Painel administrativo desativado em producao.");
  }
  const now = new Date().toISOString();
  const params = toParams(property, now);
  getDb().prepare(`
    INSERT INTO properties (
      id, name, builder, location, type, price, terms, discounts, installment_entry,
      delivery, area, bedrooms, photos_json, pdf_name, pdf_data, builder_url,
      whatsapp, instagram, internal_notes, sales_text, created_at, updated_at
    ) VALUES (
      @id, @name, @builder, @location, @type, @price, @terms, @discounts, @installment_entry,
      @delivery, @area, @bedrooms, @photos_json, @pdf_name, @pdf_data, @builder_url,
      @whatsapp, @instagram, @internal_notes, @sales_text, @created_at, @updated_at
    )
  `).run(params);
  return getProperty(params.id);
}

export function updateProperty(id, property) {
  if (!canUseLocalDatabase) {
    throw new Error("Painel administrativo desativado em producao.");
  }
  const existing = getProperty(id);
  if (!existing) return null;
  const params = toParams({ ...existing, ...property, id, createdAt: existing.createdAt }, new Date().toISOString());
  getDb().prepare(`
    UPDATE properties SET
      name = @name,
      builder = @builder,
      location = @location,
      type = @type,
      price = @price,
      terms = @terms,
      discounts = @discounts,
      installment_entry = @installment_entry,
      delivery = @delivery,
      area = @area,
      bedrooms = @bedrooms,
      photos_json = @photos_json,
      pdf_name = @pdf_name,
      pdf_data = @pdf_data,
      builder_url = @builder_url,
      whatsapp = @whatsapp,
      instagram = @instagram,
      internal_notes = @internal_notes,
      sales_text = @sales_text,
      updated_at = @updated_at
    WHERE id = @id
  `).run(params);
  return getProperty(id);
}

export function deleteProperty(id) {
  if (!canUseLocalDatabase) {
    throw new Error("Painel administrativo desativado em producao.");
  }
  return getDb().prepare("DELETE FROM properties WHERE id = ?").run(id).changes > 0;
}

export function seedIfEmpty() {
  if (!canUseLocalDatabase) return;
  const total = getDb().prepare("SELECT COUNT(*) AS total FROM properties").get().total;
  if (total > 0) return;

  createProperty({
    name: "Residencial Aurora",
    builder: "Construtora Horizonte",
    location: "Marília, Centro",
    type: "apartamento",
    price: "R$ 389.000",
    terms: "Financiamento bancário, uso de FGTS e fluxo durante obra.",
    discounts: "Subsídios conforme renda e campanha de lançamento por tempo limitado.",
    installmentEntry: "Entrada em até 36 parcelas",
    delivery: "2º semestre de 2027",
    area: "52 a 78 m²",
    bedrooms: "2 e 3 quartos",
    photos: [],
    pdfName: "",
    pdfData: "",
    builderUrl: "https://example.com",
    whatsapp: "5511999999999",
    instagram: "@matheusmachado",
    internalNotes: "Exemplo inicial. Edite ou exclua no painel.",
    salesText: "Um empreendimento moderno, bem localizado e com condições facilitadas para compra em Marília."
  });
}

function rowToProperty(row) {
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
    photos: safeJson(row.photos_json, []),
    pdfName: row.pdf_name,
    pdfData: row.pdf_data,
    builderUrl: row.builder_url,
    whatsapp: row.whatsapp,
    instagram: row.instagram,
    internalNotes: row.internal_notes,
    salesText: row.sales_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toParams(property, now) {
  return {
    id: property.id || randomUUID(),
    name: text(property.name) || "Empreendimento sem nome",
    builder: text(property.builder),
    location: text(property.location),
    type: TYPES.includes(property.type) ? property.type : "apartamento",
    price: text(property.price),
    terms: text(property.terms),
    discounts: text(property.discounts),
    installment_entry: text(property.installmentEntry),
    delivery: text(property.delivery),
    area: text(property.area),
    bedrooms: text(property.bedrooms),
    photos_json: JSON.stringify(Array.isArray(property.photos) ? property.photos : []),
    pdf_name: text(property.pdfName),
    pdf_data: text(property.pdfData),
    builder_url: text(property.builderUrl),
    whatsapp: text(property.whatsapp),
    instagram: text(property.instagram),
    internal_notes: text(property.internalNotes),
    sales_text: text(property.salesText),
    created_at: property.createdAt || now,
    updated_at: now
  };
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
