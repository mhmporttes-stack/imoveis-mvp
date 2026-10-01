// Puro (sem banco, sem "server-only") — identifica o tipo REAL de uma imagem
// pelos primeiros bytes (assinatura do formato), sem confiar no MIME que o
// navegador informa. Testado em tests/image-signature.test.mjs.
//
// Usado no upload público de captação (app/api/uploads/captacoes): um
// arquivo qualquer renomeado para .jpg, ou enviado com Content-Type de
// imagem, é recusado se o conteúdo não for de fato JPEG, PNG ou WEBP.
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function startsWith(bytes, signature, offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

// bytes: Uint8Array/Buffer. Devolve o MIME detectado ou "" quando não é um
// dos formatos aceitos.
export function detectImageType(bytes) {
  if (!bytes || typeof bytes.length !== "number") return "";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return "";
}
