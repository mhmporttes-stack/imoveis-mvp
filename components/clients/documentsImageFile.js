"use client";

// "Baixar imagem da lista" sem SAIR do app (bug relatado em 2026-10-06): no
// app instalado do iPhone (PWA), um <a download> abre o PNG na pré-visualização
// do iOS, que não tem botão de voltar — o corretor precisava fechar o app.
// Agora a imagem é buscada aqui mesmo e:
//  - celular com menu de compartilhar (iOS/Android): abre o menu do sistema
//    ("Salvar imagem", WhatsApp, etc.) por cima do app;
//  - computador: baixa o arquivo sem trocar de página.
// O link é sempre lido no MESMO domínio da tela (só caminho + busca), então
// funciona igual no domínio da marca e no da Vercel.

export function sameOriginPath(link) {
  try {
    const url = new URL(link, window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return "";
  }
}

export async function fetchDocumentsImage(link) {
  const path = sameOriginPath(link);
  if (!path) throw new Error("Link da imagem inválido.");
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível gerar a imagem da lista.");
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1] || "lista-de-documentos.png";
  return new File([blob], decodeURIComponent(name), { type: blob.type || "image/png" });
}

// -> "shared" | "downloaded" | "cancelled"
export async function saveOrShareImage(file) {
  const canShareFile = typeof navigator !== "undefined" && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] });
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (canShareFile && touch) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      // Sem permissão de compartilhar (gesto expirado etc.): cai no download.
    }
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return "downloaded";
}
