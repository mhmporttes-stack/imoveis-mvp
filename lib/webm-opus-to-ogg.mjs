// Converte a gravação do navegador (WebM com áudio Opus, o que o Chrome/Edge
// geram no MediaRecorder) para OGG/Opus — o formato que o WhatsApp Cloud API
// aceita (e exibe como mensagem de voz). Só troca o "contêiner": os pacotes
// Opus são copiados como estão, sem recodificar (nenhuma perda de qualidade e
// sem dependência externa). Roda no navegador e no Node (testes).

const ID = {
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  CodecPrivate: 0x63a2,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1
};
// Elementos "contêiner" em que só precisamos entrar (varredura linear — assim
// tamanhos desconhecidos, comuns em gravação ao vivo, não atrapalham).
const MASTER = new Set([ID.Segment, ID.Cluster, ID.Tracks, ID.TrackEntry, ID.BlockGroup]);

function readId(bytes, position) {
  const first = bytes[position];
  if (first === undefined) return null;
  let length = 1;
  for (let mask = 0x80; length <= 4 && !(first & mask); mask >>= 1) length += 1;
  if (length > 4 || position + length > bytes.length) return null;
  let value = 0;
  for (let index = 0; index < length; index += 1) value = value * 256 + bytes[position + index];
  return { value, length };
}

function readSize(bytes, position) {
  const first = bytes[position];
  if (first === undefined) return null;
  let length = 1;
  for (let mask = 0x80; length <= 8 && !(first & mask); mask >>= 1) length += 1;
  if (length > 8 || position + length > bytes.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let index = 1; index < length; index += 1) {
    const byte = bytes[position + index];
    if (byte !== 0xff) allOnes = false;
    value = value * 256 + byte;
  }
  return { value: allOnes ? -1 : value, length };
}

/** Extrai { head, packets[] } (OpusHead do CodecPrivate + pacotes Opus). */
export function parseWebmOpus(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const packets = [];
  let head = null;
  let position = 0;

  while (position < bytes.length) {
    const id = readId(bytes, position);
    if (!id) break;
    const size = readSize(bytes, position + id.length);
    if (!size) break;
    const dataStart = position + id.length + size.length;

    if (MASTER.has(id.value)) {
      position = dataStart;
      continue;
    }
    if (size.value < 0) break; // tamanho desconhecido fora de um contêiner: formato inesperado
    const dataEnd = dataStart + size.value;
    if (dataEnd > bytes.length) break;

    if (id.value === ID.CodecPrivate && !head) {
      head = bytes.slice(dataStart, dataEnd);
    } else if (id.value === ID.SimpleBlock || id.value === ID.Block) {
      // número da faixa (vint) + tempo (2 bytes) + flags (1 byte) + quadro(s)
      const track = readSize(bytes, dataStart);
      if (track) {
        const flagsAt = dataStart + track.length + 2;
        const flags = bytes[flagsAt];
        const payloadStart = flagsAt + 1;
        if (payloadStart < dataEnd && (flags & 0x06) === 0) packets.push(bytes.slice(payloadStart, dataEnd));
      }
    }
    position = dataEnd;
  }

  if (!packets.length) throw new Error("Nenhum áudio Opus encontrado na gravação.");
  return { head, packets };
}

/** Amostras (a 48 kHz) que um pacote Opus representa, pelo byte TOC. */
export function opusPacketSamples(packet) {
  if (!packet?.length) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  let frameMs;
  if (config < 12) frameMs = [10, 20, 40, 60][config % 4];
  else if (config < 16) frameMs = [10, 20][config % 2];
  else frameMs = [2.5, 5, 10, 20][config % 4];
  const code = toc & 0x03;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] || 0) & 0x3f : 2;
  return Math.round(frameMs * 48 * frames);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index << 24;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
    table[index] = crc >>> 0;
  }
  return table;
})();

export function oggCrc(bytes) {
  let crc = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) & 0xff) ^ bytes[index]]) >>> 0;
  }
  return crc >>> 0;
}

function buildPage({ packets, headerType, granule, serial, sequence }) {
  const segments = [];
  for (const packet of packets) {
    let remaining = packet.length;
    while (remaining >= 255) {
      segments.push(255);
      remaining -= 255;
    }
    segments.push(remaining);
  }
  const bodyLength = packets.reduce((sum, packet) => sum + packet.length, 0);
  const page = new Uint8Array(27 + segments.length + bodyLength);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53, 0, headerType]); // "OggS", versão 0
  view.setBigUint64(6, BigInt(granule), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  // CRC (offset 22) entra zerado no cálculo
  page[26] = segments.length;
  page.set(segments, 27);
  let offset = 27 + segments.length;
  for (const packet of packets) {
    page.set(packet, offset);
    offset += packet.length;
  }
  view.setUint32(22, oggCrc(page), true);
  return page;
}

function buildOpusHead(head) {
  if (head && head.length >= 19 && String.fromCharCode(...head.slice(0, 8)) === "OpusHead") return head;
  const fallback = new Uint8Array(19);
  fallback.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 1]); // "OpusHead", versão 1, mono
  new DataView(fallback.buffer).setUint16(10, 312, true); // pre-skip padrão
  new DataView(fallback.buffer).setUint32(12, 48000, true);
  return fallback;
}

function buildOpusTags() {
  const vendor = new TextEncoder().encode("crm");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // "OpusTags"
  const view = new DataView(tags.buffer);
  view.setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  view.setUint32(12 + vendor.length, 0, true);
  return tags;
}

/** Monta o arquivo OGG/Opus (Uint8Array) a partir do cabeçalho e dos pacotes. */
export function buildOggOpus({ head, packets, serial = 0x1a2b3c4d }) {
  const pages = [];
  let sequence = 0;
  pages.push(buildPage({ packets: [buildOpusHead(head)], headerType: 0x02, granule: 0, serial, sequence: sequence++ }));
  pages.push(buildPage({ packets: [buildOpusTags()], headerType: 0x00, granule: 0, serial, sequence: sequence++ }));

  let granule = 0;
  let batch = [];
  let batchSegments = 0;
  const flush = (last) => {
    if (!batch.length) return;
    pages.push(buildPage({ packets: batch, headerType: last ? 0x04 : 0x00, granule, serial, sequence: sequence++ }));
    batch = [];
    batchSegments = 0;
  };

  packets.forEach((packet, index) => {
    const segments = Math.floor(packet.length / 255) + 1;
    if (batch.length && (batchSegments + segments > 250 || batch.length >= 50)) flush(false);
    batch.push(packet);
    batchSegments += segments;
    granule += opusPacketSamples(packet);
    if (index === packets.length - 1) flush(true);
  });

  const total = pages.reduce((sum, page) => sum + page.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const page of pages) {
    output.set(page, offset);
    offset += page.length;
  }
  return output;
}

/** WebM/Opus (ArrayBuffer ou Uint8Array) -> OGG/Opus (Uint8Array). */
export function webmOpusToOgg(input) {
  const { head, packets } = parseWebmOpus(input);
  return buildOggOpus({ head, packets });
}
