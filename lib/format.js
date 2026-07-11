export function propertyCity(location = "") {
  return location.split(",")[0]?.trim() || "Marília";
}

export function propertyNeighborhood(location = "") {
  return location.split(",")[1]?.trim() || "";
}

export function typeLabel(type = "") {
  const labels = {
    casa: "Casa",
    apartamento: "Apartamento",
    loteamento: "Loteamento",
    condominio: "Condomínio"
  };
  return labels[type] || "Imóvel";
}

export function statusLabel(property) {
  const text = [property.terms, property.discounts, property.delivery, property.salesText].join(" ").toLowerCase();
  if (text.includes("obra")) return "Em obras";
  if (text.includes("pré") || text.includes("pre")) return "Pré-lançamento";
  if (text.includes("lançamento") || text.includes("lancamento")) return "Lançamento";
  return "Vendas";
}

export function coverImage(property) {
  return property.photos?.[0]?.data || "/assets/hero-marilia.png";
}

export function whatsappLink(property, message) {
  const phone = "5514998407380";
  const text = encodeURIComponent(message || `Olá! Quero saber mais sobre ${property.name}.`);
  return `https://wa.me/${phone}?text=${text}`;
}
