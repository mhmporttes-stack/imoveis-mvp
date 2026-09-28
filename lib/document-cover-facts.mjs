import { residenceSourceDecision } from "./document-policy.mjs";

export function birthDate(value) {
  const text = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text) || /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return "";
  const [year, month, day] = text.includes("/") ? [Number(match[3]), Number(match[2]), Number(match[1])] : [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1901 || year > new Date().getUTCFullYear() || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

export function coverFacts(registration, rows = [], fallback = {}) {
  const valid = rows.filter((row) => row.status === "conforme" && Number(row.confidence ?? 1) >= 0.7);
  const details = (role) => {
    const matches = valid.filter((row) => row.person_role === role);
    const official = matches.find((row) => ["rg", "cnh", "certidao_nascimento", "certidao_casamento", "cpf"].includes(row.document_type) && String(row.person_label || "").trim().split(/\s+/).length >= 2);
    const datum = (keys) => matches.map((row) => row.extracted_data || {}).map((entry) => keys.map((key) => entry[key]).find(Boolean)).find(Boolean) || "";
    const name = official?.person_label || datum(["fullName", "nomeCompleto", "nome", "name"]) || matches.find((row) => String(row.person_label || "").trim().split(/\s+/).length >= 2)?.person_label || "";
    return { name, cpf: datum(["cpf"]), pis: datum(["pis"]), birth: birthDate(datum(["birthDate", "dateOfBirth", "dataNascimento", "data_nascimento", "nascimento"])) };
  };
  const initial = details("titular");
  const spouse = details("conjuge");
  const other = details("outro");
  const secondary = registration.simulationType === "joint" && other.name ? other : spouse.name ? spouse : registration.simulationType === "joint" ? other : null;
  const principal = { ...initial, name: initial.name || registration.fullName, cpf: initial.cpf || registration.cpf, pis: initial.pis || registration.pis, birth: initial.birth || birthDate(registration.oldestBirthDate) };
  const rank = (person) => person?.birth ? person.birth.split("/").reverse().join("") : "";
  const swap = secondary?.name && rank(principal) && rank(secondary) && rank(secondary) < rank(principal);
  const primary = swap ? secondary : principal;
  const second = swap ? principal : secondary;
  const secondRole = second === spouse && registration.simulationType !== "joint" ? "CÔNJUGE" : "SEGUNDO PROPONENTE";
  const residence = valid.find((row) => row.document_type === "comprovante_residencia" && residenceSourceDecision(row.extracted_data?.residenceSource) === "accepted");
  const info = residence?.extracted_data || fallback;
  const address = typeof info.address === "object" && info.address !== null ? info.address : info;
  return {
    primary, swapped: Boolean(swap), secondary: second?.name ? { ...second, role: secondRole } : null,
    address: {
      street: address.street || address.logradouro || address.rua || (typeof info.address === "string" ? info.address : "") || fallback.address || fallback.endereco || "",
      number: address.number || address.numero || fallback.number || fallback.numero || "",
      complement: address.complement || address.complemento || fallback.complement || fallback.complemento || "",
      neighborhood: address.neighborhood || address.bairro || fallback.neighborhood || fallback.bairro || "",
      city: address.city || address.cidade || fallback.city || fallback.cidade || "",
      state: address.state || address.uf || fallback.state || fallback.uf || "",
      zip: address.zipCode || address.cep || fallback.zipCode || fallback.cep || ""
    }
  };
}
