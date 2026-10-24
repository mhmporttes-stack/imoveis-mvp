// Ponte entre o ciclo do som de cliente novo (NewClientSoundListener, que já consulta o servidor a cada 20 s) e a
// janelinha de cliente novo (ClientPopupStack, CLI-16 — dono, 2026-10-24). Sem consulta própria: a janelinha só se
// inscreve; o listener pede as janelinhas ao servidor no MESMO ciclo enquanto houver alguém inscrito e a página visível.
const consumers = new Set();
let cursor = "";
let requestPoll = null;

// Inscreve a janelinha. A primeira inscrição recomeça do zero (o servidor devolve as últimas ~12 h) e pede uma consulta
// na hora, para não esperar o próximo ciclo.
export function subscribeClientPopups(callback) {
  if (!consumers.size) cursor = "";
  consumers.add(callback);
  requestPoll?.();
  return () => consumers.delete(callback);
}

export function hasClientPopupConsumer() {
  return consumers.size > 0;
}

export function clientPopupCursor() {
  return cursor;
}

export function publishClientPopups(popups = [], nextCursor = "") {
  if (nextCursor) cursor = nextCursor;
  for (const callback of consumers) callback(popups);
}

// O listener registra como pedir uma consulta imediata; devolve a função que desfaz.
export function setClientPopupPollRequester(fn) {
  requestPoll = fn;
  return () => {
    if (requestPoll === fn) requestPoll = null;
  };
}
