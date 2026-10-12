// Chave do cache do Chat no navegador (components/chat-view-cache.js): conta REAL + conta EFETIVA ("Alterar conta").
// Trocar de conta muda a chave e descarta o que estava guardado. Sem perfil (conta legada) = sem cache.
export function chatViewerKey(auth) {
  const id = auth?.profile?.id;
  return id ? `${auth.realProfile?.id || id}:${id}` : "";
}
