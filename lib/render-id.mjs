// Identificador de cada renderização de página no servidor (desempenho, 2026-10-12): "<hora em ms>.<aleatório>".
// O navegador usa para saber se está mostrando uma tela reaproveitada/pré-carregada e precisa se atualizar
// (components/useRevalidateOnReuse.js). Não carrega dado nenhum.
export function newRenderId() {
  return `${Date.now()}.${crypto.randomUUID()}`;
}
