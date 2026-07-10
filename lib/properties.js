import { canUseLocalDatabase } from "./runtime";
import { getDb } from "./db";
import { getPublicProperty, listPublicProperties } from "./public-properties";
import { rowToProperty, toPropertyRecord, toSqliteParams } from "./property-mapper";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";

export function canManageProperties() {
  return hasSupabaseAdminConfig || canUseLocalDatabase;
}

export async function listProperties() {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("properties")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data.map(rowToProperty);
  }

  if (!canUseLocalDatabase) return listPublicProperties();

  seedIfEmpty();
  return getDb()
    .prepare("SELECT * FROM properties ORDER BY datetime(created_at) DESC")
    .all()
    .map(rowToProperty);
}

export async function getProperty(id) {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("properties")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data ? rowToProperty(data) : null;
  }

  if (!canUseLocalDatabase) return getPublicProperty(id);

  seedIfEmpty();
  const row = getDb().prepare("SELECT * FROM properties WHERE id = ?").get(id);
  return row ? rowToProperty(row) : null;
}

export async function createProperty(property) {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("properties")
      .insert(toPropertyRecord(property))
      .select("*")
      .single();

    if (error) throw error;
    return rowToProperty(data);
  }

  if (!canUseLocalDatabase) {
    throw new Error("Painel administrativo desativado em producao.");
  }

  return createSqliteProperty(property);
}

export async function updateProperty(id, property) {
  const existing = await getProperty(id);
  if (!existing) return null;

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const record = toPropertyRecord({ ...existing, ...property, id, createdAt: existing.createdAt });
    const { data, error } = await supabase
      .from("properties")
      .update(record)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return rowToProperty(data);
  }

  if (!canUseLocalDatabase) {
    throw new Error("Painel administrativo desativado em producao.");
  }

  const params = toSqliteParams({ ...existing, ...property, id, createdAt: existing.createdAt });
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

export async function deleteProperty(id) {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("properties").delete().eq("id", id);
    if (error) throw error;
    return true;
  }

  if (!canUseLocalDatabase) {
    throw new Error("Painel administrativo desativado em producao.");
  }

  return getDb().prepare("DELETE FROM properties WHERE id = ?").run(id).changes > 0;
}

export function seedIfEmpty() {
  if (!canUseLocalDatabase) return;
  const total = getDb().prepare("SELECT COUNT(*) AS total FROM properties").get().total;
  if (total > 0) return;

  createSqliteProperty({
    name: "Residencial Aurora",
    builder: "Construtora Horizonte",
    location: "Marilia, Centro",
    type: "apartamento",
    price: "R$ 389.000",
    terms: "Financiamento bancario, uso de FGTS e fluxo durante obra.",
    discounts: "Subsidios conforme renda e campanha de lancamento por tempo limitado.",
    installmentEntry: "Entrada em ate 36 parcelas",
    delivery: "2o semestre de 2027",
    area: "52 a 78 m2",
    bedrooms: "2 e 3 quartos",
    photos: [],
    pdfName: "",
    pdfData: "",
    builderUrl: "https://example.com",
    whatsapp: "5514999999999",
    instagram: "@matheusmachado",
    internalNotes: "Exemplo inicial. Edite ou exclua no painel.",
    salesText: "Empreendimento moderno, bem localizado e com condicoes facilitadas para compra em Marilia."
  });
}

function createSqliteProperty(property) {
  const params = toSqliteParams(property);
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
