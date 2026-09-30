import "server-only";

// Reexporta a leitura pura de config (ver google-contacts-config-core.mjs —
// testável isoladamente, sem "server-only"). Este arquivo é o único ponto de
// import usado pelo resto do app (lib/google-contacts.js, rotas), mantendo a
// marca "server-only" de proteção contra uso acidental em Client Component.
export {
  GOOGLE_CONTACTS_SCOPES,
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleContactsRedirectUri,
  isGoogleContactsConfigured,
  getGoogleContactsConfigStatus
} from "./google-contacts-config-core.mjs";
