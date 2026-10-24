// Concordância de gênero e número em português do Brasil — FONTE ÚNICA para frases faladas/mostradas pelo Henry (e pelas
// funções da Alexa/Início que ele reaproveita). Regras PURAS, sem banco nem rede. Testes: tests/pt-br-concordancia.test.mjs.
//
// Dono, 2026-10-24: "Ele falou 'entraram dois transferências'. Ele devia ter dito 'entraram duas'. [...] vários lugares
// ele está falando desse jeito, colocando no masculino palavras em feminino." Causa: o texto vai à voz com o número em
// DÍGITOS ("2 transferências") e quem lê o número (ElevenLabs/OpenAI/navegador) diz sempre a forma masculina; a correção
// anterior (lista fechada de palavras femininas, 2026-10-22) não tinha "transferência" e outras. Agora:
//   - isFeminineWord: lista + terminações que em português são sempre femininas (-ção, -dade, -gem, -ência...);
//   - concordarNumeros: troca 1/2/21/200… (e "um"/"dois" escritos pelo modelo) pela forma feminina antes de palavra
//     feminina — é o que pronounceForSpeech (lib/henry-voice-providers.mjs) aplica em TODA fala do Henry;
//   - contagem / numeroPorExtenso: montadores de frase ("uma transferência", "2 transferências", "duas clientes novas").

export function normalizeWord(word) {
  return String(word || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Palavras femininas que as terminações abaixo não pegam (sem acento, singular e plural).
const FEMININE_WORDS = new Set([
  "pessoa", "pessoas", "hora", "horas", "venda", "vendas", "reuniao", "reunioes", "mensagem", "mensagens", "conversa",
  "conversas", "visita", "visitas", "vez", "vezes", "semana", "semanas", "meta", "metas", "tentativa", "tentativas",
  "resposta", "respostas", "pendencia", "pendencias", "campanha", "campanhas", "etapa", "etapas", "casa", "casas",
  "familia", "familias", "parcela", "parcelas", "proposta", "propostas", "noticia", "noticias", "transferencia",
  "transferencias", "tarefa", "tarefas", "busca", "buscas", "corretora", "corretoras", "associada", "associadas",
  "gestora", "gestoras", "pergunta", "perguntas", "conta", "contas", "planilha", "planilhas", "foto", "fotos", "figurinha",
  "figurinhas", "midia", "midias", "chamada", "chamadas", "entrega", "entregas", "agenda", "agendas", "lista", "listas",
  "ficha", "fichas", "regra", "regras", "data", "datas", "noite", "noites", "tarde", "tardes", "manha", "manhas",
  "musica", "musicas", "playlist", "playlists", "faixa", "faixas", "fila", "filas", "nota", "notas", "despesa",
  "despesas", "comissao", "comissoes", "garantia", "garantias", "imobiliaria", "imobiliarias", "empresa", "empresas",
  "aba", "abas", "tela", "telas", "pagina", "paginas", "cidade", "cidades", "rua", "ruas", "chave", "chaves",
  "opcao", "opcoes", "ideia", "ideias", "dica", "dicas", "vaga", "vagas", "loja", "lojas", "obra", "obras", "planta",
  "plantas", "torre", "torres", "unidade", "unidades", "analise", "analises", "frase", "frases", "piada", "piadas",
  "nova", "novas", "outra", "outras", "primeira", "primeiras", "ultima", "ultimas", "mil"
]);
// Fora de propósito: "cliente(s)", "aniversariante(s)" e "lead(s)" têm os dois gêneros — o padrão é o masculino; quem
// sabe o gênero (nome da cliente) passa { genero: "f" } para contagem().

// Terminações sempre femininas em português (com as exceções masculinas comuns logo abaixo).
const FEMININE_ENDINGS = /(?:cao|coes|sao|soes|dade|dades|tude|tudes|gem|gens|encia|encias|ancia|ancias|ura|uras|ada|adas|ida|idas|ise|ises|eza|ezas)$/;
const MASCULINE_EXCEPTIONS = new Set(["cao", "caes", "pao", "paes", "chao", "chaos", "coracao", "coracoes", "nada", "mapa", "dia"]);

// "mil" só é feminino quando o que vem depois é feminino ("2 mil pessoas" → duas; "2 mil reais" → dois).
export function isFeminineWord(word, nextWord = "") {
  const key = normalizeWord(word);
  if (!key || /\d/.test(key)) return false;
  if (key === "mil") return isFeminineWord(nextWord);
  if (FEMININE_WORDS.has(key)) return true;
  if (MASCULINE_EXCEPTIONS.has(key)) return false;
  return key.length > 3 && FEMININE_ENDINGS.test(key);
}

const UNITS = { m: ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"], f: ["", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"] };
const TEENS = ["dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = {
  m: ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"],
  f: ["", "cento", "duzentas", "trezentas", "quatrocentas", "quinhentas", "seiscentas", "setecentas", "oitocentas", "novecentas"]
};

// Número inteiro de 0 a 999 por extenso no gênero pedido ("f" ou "m"). Fora disso devolve os dígitos.
export function numeroPorExtenso(n, genero = "m") {
  const g = genero === "f" ? "f" : "m";
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n === 0) return "zero";
  if (n === 100) return "cem";
  const parts = [];
  const h = Math.floor(n / 100), rest = n % 100;
  if (h) parts.push(HUNDREDS[g][h]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    const t = Math.floor(rest / 10), u = rest % 10;
    if (t) parts.push(TENS[t]);
    if (u) parts.push(UNITS[g][u]);
  }
  return parts.join(" e ");
}

// A forma falada muda com o gênero? (1, 2, x1, x2 — menos 11/12 — e centenas 200–900.)
function genderChangesSpoken(n) {
  const last = n % 10, lastTwo = n % 100;
  return ((last === 1 || last === 2) && lastTwo !== 11 && lastTwo !== 12) || Math.floor(n / 100) >= 2;
}

// Contagem pronta para a frase: n = 1 → "uma transferência"/"um cliente novo"; senão "2 transferências" (dígitos: a tela
// mostra o número e a voz concorda por concordarNumeros) ou por extenso com { extenso: true } ("duas transferências").
// genero: "f"/"m"; sem ele, vem da 1ª palavra do substantivo.
// Substantivo de dois gêneros no feminino ("clientes novas"): a voz não teria como saber — vai por extenso quando muda.
export function contagem(n, singular, plural, { genero, extenso = false } = {}) {
  const head = String(plural || singular).split(/\s+/)[0];
  const g = genero === "f" || genero === "m" ? genero : isFeminineWord(head) ? "f" : "m";
  if (n === 1) return `${g === "f" ? "uma" : "um"} ${singular}`;
  const spell = extenso || (g === "f" && !isFeminineWord(head) && Number.isInteger(n) && genderChangesSpoken(n));
  return `${spell ? numeroPorExtenso(n, g) : n} ${plural}`;
}

const WORD = "[A-Za-zÀ-ÿ]+";

// Corrige o gênero do número antes de palavra feminina, no texto que vai para a VOZ:
//   "21 prospecções" → "vinte e uma prospecções", "2 transferências" → "duas transferências", "200 visitas" → "duzentas
//   visitas", "2 mil pessoas" → "duas mil pessoas"; e o "um/dois" escrito pelo modelo: "dois transferências" → "duas".
// Só inteiros de até 3 dígitos (nunca decimal, hora "10:30" nem milhar "1.200") e só quando a forma falada muda.
export function concordarNumeros(text) {
  return String(text || "")
    .replace(new RegExp(`(^|[^\\d.,:])(\\d{1,3})(?!\\d)(?![.,:]\\d)(\\s+)(${WORD})(?=(\\s+(${WORD}))?)`, "g"), (match, lead, digits, space, word, _tail, next) => {
      const n = Number(digits);
      if (!n || !genderChangesSpoken(n) || !isFeminineWord(word, next)) return match;
      return `${lead}${numeroPorExtenso(n, "f")}${space}${word}`;
    })
    .replace(new RegExp(`\\b(um|dois|Um|Dois)(\\s+)(${WORD})(?=(\\s+(${WORD}))?)`, "g"), (match, number, space, word, _tail, next) => {
      if (!isFeminineWord(word, next)) return match;
      const lower = number.toLowerCase() === "um" ? "uma" : "duas";
      return `${number[0] === number[0].toUpperCase() ? lower[0].toUpperCase() + lower.slice(1) : lower}${space}${word}`;
    });
}
