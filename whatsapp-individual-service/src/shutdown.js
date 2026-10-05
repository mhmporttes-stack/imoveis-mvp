// Encerramento GRACIOSO do serviço (SIGTERM/SIGINT do Railway em deploy/restart).
//
// Ordem (cada passo tem seu limite de tempo; uma falha nunca impede os seguintes):
//   1) parar de aceitar conexões/retomadas/reconexões (flags);
//   2) fechar os sockets SEM logout e SEM apagar credenciais (a sessão fica 'connected' no banco
//      para o próximo dono do lease retomar);
//   3) descarregar as gravações de credenciais pendentes (senão o último estado do Signal se perde
//      e a sessão corrompe aos poucos — erro "Bad MAC");
//   4) LIBERAR o lease (só depois de 2 e 3: é o sinal para o serviço novo começar);
//   5) enviar a telemetria pendente.
// Sinal repetido (SIGTERM duplo) não reexecuta nada: devolve a mesma execução.
// Módulo puro: tudo injetado, nenhum efeito próprio (testável sem processo real).

export function createShutdown({
  stopAccepting = async () => {},
  closeSockets = async () => {},
  flushCredentials = async () => {},
  releaseLease = async () => {},
  flushTelemetry = async () => {},
  record = () => {},
  exit = (code) => process.exit(code),
  log = console,
  stepTimeoutMs = 8000,
  releaseTimeoutMs = 5000
} = {}) {
  let running = null;

  const withTimeout = (promise, ms) => Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => { const t = setTimeout(() => resolve("timeout"), ms); t.unref?.(); })
  ]);

  async function step(name, fn, ms) {
    try {
      const result = await withTimeout(fn(), ms);
      if (result === "timeout") log.warn?.(`[shutdown] Passo '${name}' passou de ${ms} ms; seguindo.`);
    } catch (error) {
      log.error?.(`[shutdown] Passo '${name}' falhou:`, error?.message || error);
    }
  }

  async function run(signal) {
    log.log?.(`${signal} recebido — encerrando sessões sem logout, gravando credenciais e liberando o lease…`);
    try { record(signal); } catch { /* telemetria nunca impede o encerramento */ }
    await step("stop_accepting", stopAccepting, stepTimeoutMs);
    await step("close_sockets", closeSockets, stepTimeoutMs);
    await step("flush_credentials", flushCredentials, stepTimeoutMs);
    await step("release_lease", releaseLease, releaseTimeoutMs);
    await step("flush_telemetry", flushTelemetry, releaseTimeoutMs);
  }

  return function shutdown(signal = "SIGTERM") {
    if (running) {
      log.log?.(`${signal} repetido ignorado — encerramento já em andamento.`);
      return running;
    }
    running = run(signal).finally(() => exit(0));
    return running;
  };
}
