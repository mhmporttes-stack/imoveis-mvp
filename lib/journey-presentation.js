export function personalizeJourney(text, values) {
  return String(text || "").replace(/\{(primeiro_nome|codigo_cliente|link_minha_jornada)\}/g, (_, key) => String(values[key] || ""));
}

export function isJourneyCelebrating(changedAt, now = Date.now()) {
  const elapsed = now - new Date(changedAt).getTime();
  return elapsed >= 0 && elapsed < 86400000;
}

export function journeyNoticeLabel(state) {
  if (!state?.notified_at) return "Avisar progresso";
  return state.notified_version === state.version ? "Progresso avisado" : "Avisar novo progresso";
}

export function publicJourneyDTO(client, state, config, phone, globalCopy) {
  const values = { primeiro_nome: String(client.full_name || "").trim().split(/\s+/)[0] || "Olá", codigo_cliente: client.client_code };
  const text = (value) => personalizeJourney(value, values);
  const contactText = text(globalCopy.contact);
  const digits = String(phone || "").replace(/\D/g, "");
  const validPhone = /^55\d{10,11}$/.test(digits) ? digits : /^\d{10,11}$/.test(digits) ? `55${digits}` : "";
  return {
    firstName: values.primeiro_nome,
    progress: state.progress,
    previousProgress: state.previous_progress,
    changedAt: state.changed_at,
    title: text(config.title), subtitle: text(config.subtitle), body: text(config.body),
    publicName: text(config.public_name),
    ctaLabel: "Falar com meu corretor",
    ctaUrl: validPhone ? `https://wa.me/${validPhone}?text=${encodeURIComponent(contactText)}` : null,
    copy: Object.fromEntries(Object.entries(globalCopy).filter(([key]) => key !== "contact").map(([key, value]) => [key, text(value)]))
  };
}
