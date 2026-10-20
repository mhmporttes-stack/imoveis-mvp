"use client";

// Compressão de foto no navegador + envio para o bucket de imóveis (/api/uploads/images). Extraído de
// components/PropertyForm.jsx (mesmo código) para ser usado também pela galeria do Marketplace.

export const MAX_PHOTO_UPLOAD_BYTES = 1_200_000;

export async function optimizeImageFile(file, options = {}) {
  const { maxWidth = 1600, maxHeight = 1200, quality = 0.74 } = options;
  const image = await loadImage(file);
  const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Não foi possível otimizar a imagem neste navegador.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, quality);
  return {
    name: file.name.replace(/\.[^.]+$/, ".jpg"),
    blob
  };
}

export async function uploadPhoto(blob, name, propertyId) {
  const formData = new FormData();
  formData.append("file", blob, name);
  formData.append("propertyId", propertyId);

  const response = await fetch("/api/uploads/images", {
    method: "POST",
    body: formData
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || `Não foi possível enviar ${name}.`);
  }

  return {
    name: result.name || name,
    data: result.data,
    storagePath: result.storagePath
  };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível carregar uma das imagens selecionadas."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Não foi possível compactar a imagem."));
    }, "image/jpeg", quality);
  });
}

// As mesmas 3 tentativas de compressão do cadastro de imóvel; erro se continuar grande.
export async function compressForUpload(file) {
  let optimized = await optimizeImageFile(file);
  if (optimized.blob.size > MAX_PHOTO_UPLOAD_BYTES) optimized = await optimizeImageFile(file, { maxWidth: 1280, maxHeight: 960, quality: 0.62 });
  if (optimized.blob.size > MAX_PHOTO_UPLOAD_BYTES) optimized = await optimizeImageFile(file, { maxWidth: 1024, maxHeight: 768, quality: 0.56 });
  if (optimized.blob.size > MAX_PHOTO_UPLOAD_BYTES) throw new Error(`A foto "${file.name}" continua muito grande. Tente uma versão menor.`);
  return optimized;
}
