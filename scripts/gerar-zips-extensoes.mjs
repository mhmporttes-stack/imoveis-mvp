#!/usr/bin/env node
// Gera ferramentas/<extensão>.zip SEMPRE a partir do código da pasta (EXT-1, dono, 2026-10-29: o zip do Seguidor
// estava na 1.1.7 com o código na 1.1.11). Zip determinístico (datas fixas, ordem alfabética, sem a pasta tests/), para
// tests/extensoes-zip.test.mjs conferir byte a byte que o zip do repositório é o do código atual.
//   node scripts/gerar-zips-extensoes.mjs          → regrava os zips
//   node scripts/gerar-zips-extensoes.mjs --check  → só confere (sai com erro se algum estiver desatualizado)
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
export const EXTENSOES = ["instagram-seguidor", "marketplace-publicador"];
const IGNORAR = new Set(["tests", "node_modules", ".DS_Store"]);
// 1980-01-01 00:00 (data DOS mínima): o zip não muda se só a data do arquivo mudar.
const DOS_HORA = 0;
const DOS_DATA = (0 << 9) | (1 << 5) | 1;

function listar(pasta, base = pasta) {
  const saida = [];
  for (const nome of readdirSync(pasta).sort()) {
    if (IGNORAR.has(nome) || nome.startsWith(".")) continue;
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) saida.push(...listar(caminho, base));
    else saida.push(relative(base, caminho).split(sep).join("/"));
  }
  return saida.sort();
}

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip da pasta ferramentas/<extensao> (arquivos dentro de "<extensao>/", como o dono descompacta). */
export function gerarZip(extensao) {
  const pasta = join(RAIZ, "ferramentas", extensao);
  const locais = [];
  const centrais = [];
  let deslocamento = 0;
  for (const arquivo of listar(pasta)) {
    const dados = readFileSync(join(pasta, arquivo));
    const comprimido = deflateRawSync(dados, { level: 9 });
    const nome = Buffer.from(`${extensao}/${arquivo}`, "utf8");
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_HORA, 10);
    local.writeUInt16LE(DOS_DATA, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nome, comprimido);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_HORA, 12);
    central.writeUInt16LE(DOS_DATA, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(0, 30); // extra + comentário
    central.writeUInt32LE(0, 34); // disco + atributos internos
    central.writeUInt32LE(0, 38); // atributos externos
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nome);
    deslocamento += local.length + nome.length + comprimido.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(centrais.length / 2, 8);
  fim.writeUInt16LE(centrais.length / 2, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

/** Arquivos de um zip (deflate ou sem compressão): { nome: Buffer }. */
export function lerZip(buffer) {
  const fimEm = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fimEm < 0) throw new Error("zip sem diretório central");
  const total = buffer.readUInt16LE(fimEm + 10);
  let p = buffer.readUInt32LE(fimEm + 16);
  const arquivos = {};
  for (let i = 0; i < total; i += 1) {
    const metodo = buffer.readUInt16LE(p + 10);
    const tamanho = buffer.readUInt32LE(p + 20);
    const lenNome = buffer.readUInt16LE(p + 28);
    const lenExtra = buffer.readUInt16LE(p + 30);
    const lenComent = buffer.readUInt16LE(p + 32);
    const local = buffer.readUInt32LE(p + 42);
    const nome = buffer.toString("utf8", p + 46, p + 46 + lenNome);
    const inicio = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const bruto = buffer.subarray(inicio, inicio + tamanho);
    if (!nome.endsWith("/")) arquivos[nome] = metodo === 8 ? inflateRawSync(bruto) : Buffer.from(bruto);
    p += 46 + lenNome + lenExtra + lenComent;
  }
  return arquivos;
}

export function caminhoZip(extensao) {
  return join(RAIZ, "ferramentas", `${extensao}.zip`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const conferir = process.argv.includes("--check");
  let desatualizado = false;
  for (const extensao of EXTENSOES) {
    const novo = gerarZip(extensao);
    const atual = existsSync(caminhoZip(extensao)) ? readFileSync(caminhoZip(extensao)) : null;
    const versao = JSON.parse(readFileSync(join(RAIZ, "ferramentas", extensao, "manifest.json"), "utf8")).version;
    if (atual && atual.equals(novo)) {
      console.log(`${extensao}.zip em dia (versão ${versao}).`);
      continue;
    }
    if (conferir) {
      desatualizado = true;
      console.error(`${extensao}.zip DESATUALIZADO — rode: node scripts/gerar-zips-extensoes.mjs`);
      continue;
    }
    writeFileSync(caminhoZip(extensao), novo);
    console.log(`${extensao}.zip gerado (versão ${versao}).`);
  }
  if (desatualizado) process.exit(1);
}
