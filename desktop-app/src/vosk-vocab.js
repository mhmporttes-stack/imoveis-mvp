// Vocabulário do modelo Vosk (versão 1.2.1): lê a tabela de símbolos de saída do Gr.fst DENTRO do .tar.gz do modelo,
// sem extrair nada para o disco. Serve para a gramática usar só palavras que o modelo conhece (palavra fora do
// vocabulário vira [unk] e o Vosk a ignora) e para conferir a palavra de chamada escolhida pelo dono.
// Partes puras (parseFstSymbols, createTarScanner) testadas em tests/wake.test.js.
"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");

const FST_MAGIC = 2125659606;
const SYMBOLS_MAGIC = 2125658996;
const MAX_HEADER_BYTES = 8 * 1024 * 1024; // a tabela do small-pt tem ~1,2 MB; acima disso algo está errado

// Cabeçalho binário do OpenFst (+ tabelas de símbolos, flags 1 = entrada, 2 = saída) → lista de palavras da SAÍDA.
// Buffer curto demais → RangeError (quem chama lê mais e tenta de novo).
function parseFstSymbols(buffer) {
  let offset = 0;
  const int32 = () => {
    if (offset + 4 > buffer.length) throw new RangeError("curto");
    const value = buffer.readInt32LE(offset);
    offset += 4;
    return value;
  };
  const int64 = () => {
    if (offset + 8 > buffer.length) throw new RangeError("curto");
    const value = Number(buffer.readBigInt64LE(offset));
    offset += 8;
    return value;
  };
  const text = () => {
    const size = int32();
    if (size < 0 || size > 4096) throw new Error("fst_invalido");
    if (offset + size > buffer.length) throw new RangeError("curto");
    const value = buffer.toString("utf8", offset, offset + size);
    offset += size;
    return value;
  };
  const table = () => {
    if (int32() !== SYMBOLS_MAGIC) throw new Error("fst_invalido");
    text();
    int64(); // available key
    const size = int64();
    if (size < 0 || size > 2000000) throw new Error("fst_invalido");
    const words = new Array(size);
    for (let index = 0; index < size; index += 1) {
      words[index] = text();
      int64();
    }
    return words;
  };
  if (int32() !== FST_MAGIC) throw new Error("fst_invalido");
  text(); // tipo
  text(); // arco
  int32(); // versão
  const flags = int32();
  int64(); // propriedades
  int64(); // início
  int64(); // estados
  int64(); // arcos
  const input = flags & 1 ? table() : null;
  const output = flags & 2 ? table() : null;
  const words = output || input;
  if (!words) throw new Error("fst_sem_simbolos");
  return words;
}

// Percorre um .tar em pedaços (streaming) e entrega até maxBytes do começo do arquivo cujo nome termina com `suffix`.
// onData(buffer acumulado) devolve true quando já basta (o scanner para de guardar).
function createTarScanner(suffix, onData, maxBytes = MAX_HEADER_BYTES) {
  let pending = Buffer.alloc(0);
  let skip = 0; // bytes do arquivo atual (+ preenchimento) a pular
  let collect = 0; // bytes do arquivo alvo ainda a guardar
  let collected = [];
  let collectedSize = 0;
  let triedAt = 0;
  let done = false;
  return {
    get done() {
      return done;
    },
    push(chunk) {
      if (done) return;
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (!done && pending.length) {
        if (collect > 0) {
          const piece = pending.subarray(0, Math.min(collect, pending.length));
          pending = pending.subarray(piece.length);
          collect -= piece.length;
          skip -= piece.length;
          collected.push(piece);
          collectedSize += piece.length;
          // Tenta a leitura a cada ~256 KB guardados (e no fim do arquivo), não a cada pedaço.
          const last = collect === 0 || collectedSize >= maxBytes;
          if (!last && collectedSize - triedAt < 262144) continue;
          triedAt = collectedSize;
          collected = [Buffer.concat(collected, collectedSize)];
          if (onData(collected[0]) || last) done = true;
          continue;
        }
        if (skip > 0) {
          const size = Math.min(skip, pending.length);
          pending = pending.subarray(size);
          skip -= size;
          continue;
        }
        if (pending.length < 512) return;
        const header = pending.subarray(0, 512);
        pending = pending.subarray(512);
        if (header.every((byte) => byte === 0)) {
          done = true;
          return;
        }
        const name = header.toString("utf8", 0, 100).replace(/\0.*$/s, "");
        const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/s, "");
        const size = parseInt(header.toString("ascii", 124, 136).replace(/\0.*$/s, "").trim() || "0", 8) || 0;
        const full = prefix ? `${prefix}/${name}` : name;
        skip = Math.ceil(size / 512) * 512;
        if (full.endsWith(suffix) && size > 0) {
          collect = Math.min(size, maxBytes);
          collected = [];
          collectedSize = 0;
          triedAt = 0;
        }
      }
    }
  };
}

// .tar.gz do modelo → Set de palavras. Lê só até o fim da tabela de símbolos do Gr.fst.
function loadVoskVocabulary(file) {
  return new Promise((resolve, reject) => {
    let words = null;
    const input = fs.createReadStream(file);
    const gunzip = zlib.createGunzip();
    const finish = (error) => {
      input.destroy();
      gunzip.destroy();
      if (words) resolve(new Set(words));
      else reject(error || new Error("vocabulario_nao_encontrado"));
    };
    const scanner = createTarScanner("/Gr.fst", (buffer) => {
      try {
        words = parseFstSymbols(buffer);
        return true;
      } catch (error) {
        if (error instanceof RangeError) return false;
        throw error;
      }
    });
    gunzip.on("data", (chunk) => {
      try {
        scanner.push(chunk);
      } catch (error) {
        finish(error);
        return;
      }
      if (scanner.done) finish();
    });
    gunzip.on("end", () => finish());
    gunzip.on("error", finish);
    input.on("error", finish);
    input.pipe(gunzip);
  });
}

module.exports = { parseFstSymbols, createTarScanner, loadVoskVocabulary };
