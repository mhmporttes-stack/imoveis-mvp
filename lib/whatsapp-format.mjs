// Formatação de texto do WhatsApp no Chat (pedido do dono, 2026-10-09 — "o mais parecido possível com o WhatsApp").
// Regras do próprio WhatsApp: *negrito*, _itálico_, ~tachado~, ```monoespaçado```, `código`, "> " citação no começo da
// linha, "- " / "* " lista e "1. " lista numerada. O marcador só vale colado no texto (não pode abrir/fechar com
// espaço), na mesma linha, e não no meio de uma palavra (ex.: arquivo_nome_x não vira itálico). Links têm prioridade.
// Puro: devolve uma árvore simples; a tela (components/WhatsappChat.jsx) só desenha. Testes: tests/whatsapp-format.test.mjs.
import { CHAT_LINK_PATTERN } from "./chat-link-preview-core.mjs";

const MARKS = { "*": "bold", "_": "italic", "~": "strike" };
const WORD = /[\p{L}\p{N}]/u;

function isWordChar(char) {
  return Boolean(char) && WORD.test(char);
}

function findClosing(text, mark, from) {
  for (let j = from; j < text.length; j += 1) {
    const char = text[j];
    if (char === "\n") return -1;
    if (char !== mark) continue;
    if (/\s/.test(text[j - 1])) continue;
    if (isWordChar(text[j + 1])) continue;
    return j;
  }
  return -1;
}

function parseMarks(text) {
  const nodes = [];
  let buffer = "";
  const flush = () => {
    if (buffer) nodes.push({ type: "text", text: buffer });
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    // ```monoespaçado``` (pode ter várias linhas)
    if (text.startsWith("```", i)) {
      const end = text.indexOf("```", i + 3);
      if (end > i + 3) {
        flush();
        nodes.push({ type: "mono", text: text.slice(i + 3, end) });
        i = end + 3;
        continue;
      }
    }
    const char = text[i];
    if (char === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1 && !text.slice(i + 1, end).includes("\n")) {
        flush();
        nodes.push({ type: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (MARKS[char] && !isWordChar(text[i - 1]) && text[i + 1] && !/\s/.test(text[i + 1]) && text[i + 1] !== char) {
      const end = findClosing(text, char, i + 2);
      if (end > i + 1) {
        flush();
        nodes.push({ type: MARKS[char], children: parseMarks(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buffer += char;
    i += 1;
  }
  flush();
  return nodes;
}

// Linha -> nós (links primeiro, formatação no resto).
export function parseInline(text) {
  const parts = String(text || "").split(new RegExp(CHAT_LINK_PATTERN.source, "gi"));
  const nodes = [];
  parts.forEach((part, index) => {
    if (!part) return;
    if (index % 2 === 1) nodes.push({ type: "link", href: part, text: part });
    else nodes.push(...parseMarks(part));
  });
  return nodes;
}

// Texto inteiro -> blocos por linha (citação, lista, lista numerada ou linha comum). ``` multilinha fica num bloco só.
export function parseWhatsappText(text) {
  const source = String(text || "");
  const blocks = [];
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    // Bloco ``` que atravessa linhas: junta até fechar.
    if ((line.match(/```/g) || []).length % 2 === 1) {
      let joined = line;
      let k = index + 1;
      while (k < lines.length) {
        joined += `\n${lines[k]}`;
        if (lines[k].includes("```")) break;
        k += 1;
      }
      if (k < lines.length) {
        blocks.push({ type: "line", children: parseInline(joined) });
        index = k;
        continue;
      }
    }
    let match;
    if ((match = line.match(/^>\s?(.*)$/))) blocks.push({ type: "quote", children: parseInline(match[1]) });
    else if ((match = line.match(/^[-*]\s+(.*)$/))) blocks.push({ type: "bullet", children: parseInline(match[1]) });
    else if ((match = line.match(/^(\d{1,3})\.\s+(.*)$/))) blocks.push({ type: "numbered", number: match[1], children: parseInline(match[2]) });
    else blocks.push({ type: "line", children: parseInline(line) });
  }
  return blocks;
}

// Prévia na lista de conversas: sem os marcadores (como o WhatsApp mostra o texto).
export function stripWhatsappFormatting(text) {
  const plain = (nodes) => nodes.map((node) => (node.children ? plain(node.children) : node.text || "")).join("");
  return parseWhatsappText(text).map((block) => {
    const body = plain(block.children);
    if (block.type === "bullet") return `• ${body}`;
    if (block.type === "numbered") return `${block.number}. ${body}`;
    return body;
  }).join("\n");
}
