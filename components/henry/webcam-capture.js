// Captura de UM quadro da webcam para a visão do Henry (HENRY-2). A câmera só abre no momento do pedido, espera ~800 ms
// para a exposição estabilizar, tira 1 quadro reduzido (lado maior ≤ 768 px, JPEG q 0,7) e desliga as trilhas na hora
// (a luz da webcam apaga). Nada de câmera contínua. Qualquer falha (sem webcam, sem permissão, tempo esgotado) → null:
// o Henry segue sem visão e sem erro falado.

const SETTLE_MS = 800;
const MAX_SIDE = 768;
const QUALITY = 0.7;
const TIMEOUT_MS = 6000;

export async function captureWebcamFrame() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  let stream = null;
  const video = document.createElement("video");
  try {
    stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS))
    ]);
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", QUALITY);
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
}
