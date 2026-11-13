// "Copiar imagem" da ficha do chamado (dono): Clipboard API com ClipboardItem. A área de transferência aceita PNG de forma
// confiável (JPEG não, no Chrome), então a imagem é convertida no navegador; o blob vai como PROMESSA para o Safari manter o
// gesto do toque. Devolve true se copiou; false = o chamador mostra a imagem para segurar e copiar (fallback).
export async function copyImageToClipboard(url) {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
  try {
    const pngBlob = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("imagem indisponível");
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("conversão falhou");
      return blob;
    })();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    return true;
  } catch {
    return false;
  }
}

export async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
