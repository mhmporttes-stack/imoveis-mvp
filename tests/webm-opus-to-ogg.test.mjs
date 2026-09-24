import test from "node:test";
import assert from "node:assert/strict";
import { buildOggOpus, oggCrc, opusPacketSamples, parseWebmOpus, webmOpusToOgg } from "../lib/webm-opus-to-ogg.mjs";

// --- helpers para montar um WebM mínimo (como o MediaRecorder do Chrome) ---
const idBytes = (value) => {
  const out = [];
  let v = value;
  while (v > 0) { out.unshift(v & 0xff); v = Math.floor(v / 256); }
  return out;
};
const sizeBytes = (length) => (length < 127 ? [0x80 | length] : [0x40 | (length >> 8), length & 0xff]);
const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const element = (id, payload, unknown = false) => [...idBytes(id), ...(unknown ? UNKNOWN_SIZE : sizeBytes(payload.length)), ...payload];

function opusHead() {
  const head = new Uint8Array(19);
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 1]);
  new DataView(head.buffer).setUint16(10, 312, true);
  new DataView(head.buffer).setUint32(12, 48000, true);
  return [...head];
}

// pacote Opus fictício de 20 ms (TOC config 19, código 0) com `extra` bytes
const opusPacket = (extra, fill) => [0x98, ...Array.from({ length: extra }, (_, index) => (fill + index) & 0xff)];

function buildWebm(packets) {
  const blocks = packets.flatMap((packet) => element(0xa3, [0x81, 0x00, 0x00, 0x80, ...packet]));
  const cluster = element(0x1f43b675, [...element(0xe7, [0x00]), ...blocks], true);
  const tracks = element(0x1654ae6b, element(0xae, [...element(0xd7, [1]), ...element(0x63a2, opusHead())]));
  const segment = element(0x18538067, [...element(0x1549a966, [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]), ...tracks, ...cluster], true);
  return new Uint8Array([...element(0x1a45dfa3, [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]), ...segment]);
}

// leitor de OGG para conferir o resultado
function readOgg(bytes) {
  const pages = [];
  let position = 0;
  while (position < bytes.length) {
    assert.equal(String.fromCharCode(...bytes.slice(position, position + 4)), "OggS");
    const view = new DataView(bytes.buffer, bytes.byteOffset + position);
    const segmentCount = bytes[position + 26];
    const table = [...bytes.slice(position + 27, position + 27 + segmentCount)];
    const bodyLength = table.reduce((a, b) => a + b, 0);
    const pageLength = 27 + segmentCount + bodyLength;
    const page = bytes.slice(position, position + pageLength);
    const copy = page.slice();
    new DataView(copy.buffer).setUint32(22, 0, true);
    assert.equal(oggCrc(copy), view.getUint32(22, true), "CRC da página");
    const packets = [];
    let offset = 27 + segmentCount;
    let current = [];
    for (const length of table) {
      current.push(...page.slice(offset, offset + length));
      offset += length;
      if (length < 255) { packets.push(current); current = []; }
    }
    pages.push({ headerType: bytes[position + 5], granule: Number(view.getBigUint64(6, true)), sequence: view.getUint32(18, true), packets });
    position += pageLength;
  }
  return pages;
}

test("duração dos pacotes Opus pelo TOC", () => {
  assert.equal(opusPacketSamples([0x98, 1, 2]), 960); // 20 ms
  assert.equal(opusPacketSamples([0x78 | 0x00, 1]), 960); // SILK 20 ms? config 15 (híbrido 20ms)
  assert.equal(opusPacketSamples([0x99, 1]), 1920); // código 1 = 2 quadros
});

test("WebM (segmento e cluster de tamanho desconhecido) -> pacotes e OpusHead", () => {
  const packets = [opusPacket(30, 1), opusPacket(40, 50), opusPacket(300, 90)];
  const { head, packets: parsed } = parseWebmOpus(buildWebm(packets));
  assert.equal(String.fromCharCode(...head.slice(0, 8)), "OpusHead");
  assert.deepEqual(parsed.map((packet) => [...packet]), packets);
});

test("WebM -> OGG/Opus: cabeçalhos, CRC, granule, fim de fluxo e pacotes idênticos", () => {
  const packets = Array.from({ length: 120 }, (_, index) => opusPacket(20 + (index % 7) * 60, index));
  const ogg = webmOpusToOgg(buildWebm(packets));
  const pages = readOgg(ogg);

  assert.equal(pages[0].headerType, 0x02);
  assert.equal(String.fromCharCode(...pages[0].packets[0].slice(0, 8)), "OpusHead");
  assert.equal(String.fromCharCode(...pages[1].packets[0].slice(0, 8)), "OpusTags");
  const audioPages = pages.slice(2);
  assert.ok(audioPages.length >= 3, "vários blocos de áudio");
  assert.equal(audioPages.at(-1).headerType & 0x04, 0x04, "última página marcada como fim");
  assert.equal(audioPages.at(-1).granule, 120 * 960);
  assert.deepEqual(pages.map((page) => page.sequence), pages.map((_, index) => index));
  assert.deepEqual(audioPages.flatMap((page) => page.packets), packets);
});

test("pacote com tamanho múltiplo de 255 mantém o limite de segmento", () => {
  const packets = [opusPacket(254, 3), opusPacket(509, 8)]; // 255 e 510 bytes no total
  const pages = readOgg(buildOggOpus({ head: null, packets }));
  assert.deepEqual(pages.slice(2).flatMap((page) => page.packets), packets);
});

test("gravação sem áudio é recusada", () => {
  assert.throws(() => webmOpusToOgg(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80])), /Nenhum áudio/);
});
