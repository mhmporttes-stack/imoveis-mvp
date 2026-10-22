import { canUseLocalDatabase } from "./runtime";
import { getDb } from "./db";
import { getPublicProperty, listPublicProperties } from "./public-properties";
import { rowToProperty, toPropertyRecord, toSqliteParams } from "./property-mapper";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { isMissingCardFieldError, isMissingColumnError } from "./supabase-errors";
import { canUseProfileDatabaseScope } from "./admin-profiles";
import { CACHE_TAGS, serverCache } from "./server-cache-core.mjs";
import { isEmptyPropertyContact, normalizePropertyContact, rowToPropertyContact, uniquePropertyContacts } from "./property-contact-core.mjs";

// Imóveis/empreendimentos em cache entre requisições (velocidade, etapa 3 — 2026-10-22; lib/server-cache-core.mjs): a
// lista e cada imóvel ficam 30 s por instância; toda gravação em `properties` (createProperty, updateProperty,
// deleteProperty e o vínculo da captação em lib/captacoes.js) invalida na hora. Quem vai gravar lê sem cache.
const PROPERTIES_CACHE_TTL_MS = 30_000;

export function invalidatePropertiesCache() {
  serverCache.invalidate(CACHE_TAGS.PROPERTIES);
}

export function canManageProperties() {
  return hasSupabaseAdminConfig || canUseLocalDatabase;
}

export async function listProperties() {
  const supabase = getSupabaseAdminClient();
  if (supabase) return serverCache.memo(CACHE_TAGS.PROPERTIES, "list", PROPERTIES_CACHE_TTL_MS, () => loadPropertiesFromSupabase(supabase));

  if (!canUseLocalDatabase) return listPublicProperties();

  seedIfEmpty();
  return getDb()
    .prepare("SELECT * FROM properties ORDER BY display_order ASC, datetime(created_at) DESC")
    .all()
    .map(rowToProperty);
}

async function loadPropertiesFromSupabase(supabase) {
  let { data, error } = await supabase
    .from("properties")
    .select("*")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (isMissingColumnError(error, "display_order")) {
    const fallback = await supabase
      .from("properties")
      .select("*")
      .order("created_at", { ascending: false });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return data.map(rowToProperty);
}

export async function getProperty(id) {
  if (getSupabaseAdminClient()) {
    return serverCache.memo(CACHE_TAGS.PROPERTIES, `id:${id}`, PROPERTIES_CACHE_TTL_MS, () => loadProperty(id), {
      keep: (property) => Boolean(property)
    });
  }
  return loadProperty(id);
}

async function loadProperty(id) {
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

export async function createProperty(property, auth = null) {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const propertyWithOwner = property.createdByUserId !== undefined
      ? property
      : canUseProfileDatabaseScope(auth?.profile)
        ? { ...property, createdByUserId: auth.profile.id }
        : property;
    const record = toPropertyRecord(propertyWithOwner);
    const { data, error } = await writePropertyRecord(record, (row) => supabase
      .from("properties")
      .insert(row)
      .select("*")
      .single());

    invalidatePropertiesCache();
    if (error) throw toPropertyWriteError(error, record);
    return rowToProperty(data);
  }

  if (!canUseLocalDatabase) {
    throw new Error("Painel administrativo desativado em producao.");
  }

  return createSqliteProperty(property);
}

export async function updateProperty(id, property) {
  const existing = await loadProperty(id);
  if (!existing) return null;

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const record = toPropertyRecord({ ...existing, ...property, id, createdAt: existing.createdAt });
    const { data, error } = await writePropertyRecord(record, (row) => supabase
      .from("properties")
      .update(row)
      .eq("id", id)
      .select("*")
      .single());

    invalidatePropertiesCache();
    if (error) throw toPropertyWriteError(error, record);
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
      region = @region,
      status = @status,
      type = @type,
      price = @price,
      terms = @terms,
      discounts = @discounts,
      installment_entry = @installment_entry,
      delivery = @delivery,
      area = @area,
      bedrooms = @bedrooms,
      features_json = @features_json,
      photos_json = @photos_json,
      pdf_name = @pdf_name,
      pdf_data = @pdf_data,
      builder_url = @builder_url,
      whatsapp = @whatsapp,
      instagram = @instagram,
      internal_notes = @internal_notes,
      sales_text = @sales_text,
      is_published = @is_published,
      is_featured = @is_featured,
      display_order = @display_order,
      updated_at = @updated_at
    WHERE id = @id
  `).run(params);
  return getProperty(id);
}

export async function deleteProperty(id) {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("properties").delete().eq("id", id);
    invalidatePropertiesCache();
    if (error) throw error;
    return true;
  }

  if (!canUseLocalDatabase) {
    throw new Error("Painel administrativo desativado em producao.");
  }

  return getDb().prepare("DELETE FROM properties WHERE id = ?").run(id).changes > 0;
}

// Contato do imóvel (dono, 2026-10-16) — tabela própria, só service role (ver a migration
// 20261016150000_property_contacts.sql). Fica FORA de getProperty/listProperties de propósito: só quem pede
// explicitamente (telas de admin/gestor) recebe o dado, nenhum outro consumidor de imóvel passa a carregá-lo.
export async function getPropertyContact(propertyId) {
  const supabase = getSupabaseAdminClient();
  if (!supabase || !propertyId) return normalizePropertyContact();
  const { data, error } = await supabase
    .from("property_contacts")
    .select("contact_name, contact_phone, contact_type")
    .eq("property_id", propertyId)
    .maybeSingle();
  // Tabela ainda não criada (código publicado antes da migration): sem contato cadastrado ainda.
  if (isMissingPropertyContactsTable(error)) return normalizePropertyContact();
  if (error) throw error;
  return rowToPropertyContact(data);
}

// Contatos já usados em outros imóveis, para o autocomplete do formulário (admin/gestor). Um por
// nome+telefone+tipo, o mais recente primeiro. Paginado (a lista não trunca em 1000).
export async function listPropertyContacts() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return [];
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("property_contacts")
      .select("contact_name, contact_phone, contact_type")
      .neq("contact_name", "")
      .order("updated_at", { ascending: false })
      .range(from, from + 999);
    if (isMissingPropertyContactsTable(error)) return [];
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return uniquePropertyContacts(rows.map(rowToPropertyContact));
}

export async function savePropertyContact(propertyId, input) {
  const contact = normalizePropertyContact(input);
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    if (isEmptyPropertyContact(contact)) return contact;
    throw new Error("O contato do imóvel só pode ser salvo com o banco Supabase configurado.");
  }
  const { error } = await supabase.from("property_contacts").upsert({
    property_id: propertyId,
    contact_name: contact.contactName,
    contact_phone: contact.contactPhone,
    contact_type: contact.contactType,
    updated_at: new Date().toISOString()
  }, { onConflict: "property_id" });
  if (error) {
    if (isMissingPropertyContactsTable(error)) {
      if (isEmptyPropertyContact(contact)) return contact;
      throw new Error("Os dados do imóvel foram salvos, mas o contato ainda não: o banco ainda não foi atualizado para guardar o contato do imóvel.");
    }
    throw error;
  }
  return contact;
}

function isMissingPropertyContactsTable(error) {
  if (!error) return false;
  return (error.code === "42P01" || error.code === "PGRST205")
    && String(error.message || "").toLowerCase().includes("property_contacts");
}

export function seedIfEmpty() {
  if (!canUseLocalDatabase) return;
  const total = getDb().prepare("SELECT COUNT(*) AS total FROM properties").get().total;
  if (total > 0) return;

  createSqliteProperty({
    name: "Residencial Aurora",
    builder: "Construtora Horizonte",
    location: "Marilia, Centro",
    region: "centro",
    status: "Lançamento",
    type: "apartamento",
    price: "R$ 389.000",
    terms: "Financiamento bancario, uso de FGTS e fluxo durante obra.",
    discounts: "Subsidios conforme renda e campanha de lancamento por tempo limitado.",
    installmentEntry: "Entrada em ate 36 parcelas",
    delivery: "2o semestre de 2027",
    area: "52 a 78 m2",
    bedrooms: "2 e 3 quartos",
    features: ["2 e 3 quartos", "52 a 78 m2", "Aceita financiamento", "Entrada facilitada"],
    photos: [],
    pdfName: "",
    pdfData: "",
    builderUrl: "https://example.com",
    whatsapp: "5514999999999",
    instagram: "@matheusmachado",
    internalNotes: "Exemplo inicial. Edite ou exclua no painel.",
    salesText: "Empreendimento moderno, bem localizado e com condicoes facilitadas para compra em Marilia.",
    isPublished: true,
    isFeatured: true,
    displayOrder: 0
  });
}

function createSqliteProperty(property) {
  const params = toSqliteParams(property);
  getDb().prepare(`
    INSERT INTO properties (
      id, name, builder, location, region, status, type, price, terms, discounts, installment_entry,
      delivery, area, bedrooms, features_json, photos_json, pdf_name, pdf_data, builder_url,
      whatsapp, instagram, internal_notes, sales_text, is_published, is_featured, display_order,
      created_at, updated_at
    ) VALUES (
      @id, @name, @builder, @location, @region, @status, @type, @price, @terms, @discounts, @installment_entry,
      @delivery, @area, @bedrooms, @features_json, @photos_json, @pdf_name, @pdf_data, @builder_url,
      @whatsapp, @instagram, @internal_notes, @sales_text, @is_published, @is_featured, @display_order,
      @created_at, @updated_at
    )
  `).run(params);
  return getProperty(params.id);
}

// Grava o registro com os fallbacks de schema antigo: primeiro sem a coluna
// `code` (se ela ainda não existir no banco — só ela é removida, sem perder
// região/status/etc.), depois o fallback legado dos campos de card.
async function writePropertyRecord(record, run) {
  let row = record;
  let result = await run(row);
  if (isMissingPropertyCodeColumnError(result.error)) {
    const { code, ...withoutCode } = row;
    row = withoutCode;
    result = await run(row);
  }
  if (isMissingCardFieldError(result.error)) {
    result = await run(toLegacyPropertyRecord(row));
  }
  return result;
}

function isMissingPropertyCodeColumnError(error) {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  // 42703 = Postgres; PGRST204 = cache de schema do PostgREST ("Could not find the 'code' column").
  return (error.code === "42703" || error.code === "PGRST204")
    && (message.includes("\"code\"") || message.includes("'code'"));
}

function toPropertyWriteError(error, record) {
  if (error?.code === "23505" && String(error.message || "").includes("properties_code_unique")) {
    return new Error(`Já existe outro imóvel com o código COD${record.code}.`);
  }
  return error;
}

function toLegacyPropertyRecord(record) {
  const legacyRecord = { ...record };
  delete legacyRecord.code;
  delete legacyRecord.region;
  delete legacyRecord.status;
  delete legacyRecord.features_json;
  delete legacyRecord.is_featured;
  delete legacyRecord.is_development;
  delete legacyRecord.hide_price;
  delete legacyRecord.display_order;
  delete legacyRecord.created_by_user_id;
  return legacyRecord;
}
