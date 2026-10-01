// CATÁLOGO CENTRAL de apelidos/variações de pronúncia dos corretores.
// É o ÚNICO lugar para ajustar como a Alexa reconhece um nome: o matcher
// (brokers.mjs) e o gerador do modelo de voz (model-core.mjs) leem só daqui.
// Chave = primeiro nome sem acento e em minúsculas; valor = variações que a
// Alexa costuma ouvir. Corretor novo NÃO precisa de entrada: o nome vem do
// cadastro do CRM (primeiro nome + nome completo). Entradas só ajudam quando
// a pronúncia engana o reconhecimento de voz (ex.: "Ketlin" -> "Kathleen").
export const BROKER_ALIASES = {
  bencke: ["benke", "benque", "bencki"],
  bruna: [],
  caroline: ["carol", "caroline", "carolaine"],
  eduardo: ["edu", "dudu"],
  izabela: ["isabela", "izabel", "isabel", "iza"],
  jennyfer: ["jenifer", "jennifer", "jeniffer", "jeny", "jenny"],
  ketlin: ["ketlyn", "kétlin", "kathleen", "katlin", "ketlen", "ketilin"],
  luan: ["luã"],
  lucas: []
};
