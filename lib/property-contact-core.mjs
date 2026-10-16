// Contato do imóvel (dono, 2026-10-16): quem chamar para agendar visita. Dado INTERNO — só admin/gestor
// (tabela property_contacts, RLS sem policy). Funções puras, sem acesso a banco.

export const PROPERTY_CONTACT_TYPES = [
  { value: "proprietario", label: "Proprietário" },
  { value: "corretor", label: "Corretor (parceiro)" }
];

export const PROPERTY_CONTACT_FIELDS = ["contactName", "contactPhone", "contactType"];

export function normalizePropertyContact(input = {}) {
  const type = String(input?.contactType ?? "").trim();
  return {
    contactName: String(input?.contactName ?? "").trim(),
    contactPhone: String(input?.contactPhone ?? "").trim(),
    contactType: PROPERTY_CONTACT_TYPES.some((option) => option.value === type) ? type : ""
  };
}

export function rowToPropertyContact(row) {
  return normalizePropertyContact({
    contactName: row?.contact_name,
    contactPhone: row?.contact_phone,
    contactType: row?.contact_type
  });
}

export function hasPropertyContactInput(payload) {
  return Boolean(payload) && typeof payload === "object"
    && PROPERTY_CONTACT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(payload, field));
}

export function isEmptyPropertyContact(contact) {
  const normalized = normalizePropertyContact(contact);
  return !normalized.contactName && !normalized.contactPhone && !normalized.contactType;
}

export function propertyContactTypeLabel(type) {
  return PROPERTY_CONTACT_TYPES.find((option) => option.value === type)?.label || "";
}

// Lista sem repetição (mesmo nome+telefone+tipo, ignorando maiúsculas e formato do telefone), na ordem recebida.
export function uniquePropertyContacts(contacts) {
  const seen = new Set();
  const result = [];
  for (const item of contacts || []) {
    const contact = normalizePropertyContact(item);
    if (!contact.contactName) continue;
    const key = [contact.contactName.toLowerCase(), contact.contactPhone.replace(/\D/g, ""), contact.contactType].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(contact);
  }
  return result;
}

// Contato escolhido pelo nome digitado no autocomplete (o mais recente com esse nome), ou null.
export function findPropertyContactByName(contacts, name) {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return (contacts || []).find((contact) => contact.contactName.toLowerCase() === wanted) || null;
}
