// Detector de voz local do Henry (dono, 2026-10-23 — interrupção, docs/BUSINESS_RULES.md HENRY-1). Silero VAD
// (@ricky0123/vad-web 0.0.31, ISC) sobre onnxruntime-web (MIT), rodando no próprio navegador. Os arquivos vêm do PRÓPRIO
// site (/vendor/vad/, copiados no prebuild por scripts/copy-vad-assets.mjs) — nada de CDN de terceiro — e só são baixados
// na primeira vez que o Henry fala no computador. O VAD só escuta o microfone que o Henry já abriu (cancelamento de eco
// ligado) e só diz "tem voz"/"acabou a voz"; nenhum áudio é gravado nem guardado.
const BASE = "/vendor/vad/";
let libraryPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error("detector de voz indisponível"));
    };
    document.head.appendChild(script);
  });
}

function loadVadLibrary() {
  if (typeof window === "undefined") return Promise.reject(new Error("sem janela"));
  if (window.vad?.MicVAD) return Promise.resolve(window.vad);
  if (!libraryPromise) {
    libraryPromise = (window.ort ? Promise.resolve() : loadScript(`${BASE}ort.wasm.min.js`))
      .then(() => (window.vad?.MicVAD ? null : loadScript(`${BASE}bundle.min.js`)))
      .then(() => {
        if (!window.vad?.MicVAD) throw new Error("detector de voz indisponível");
        return window.vad;
      })
      .catch((error) => {
        libraryPromise = null;
        throw error;
      });
  }
  return libraryPromise;
}

// Ajustes por uso. Interrupção (ele falando): mais exigente que o padrão (0,3) — o resto do eco da voz dele não pode contar
// como voz do dono. Gravação do pedido (ele calado, dono 2026-10-23: "uma pausa de 1 segundo e ele já começa a pensar"):
// menos exigente e com mais tolerância a pausas curtas, para respirar ou "é…" não encerrarem a fala.
export const HENRY_VAD_BARGE_OPTIONS = Object.freeze({ positiveSpeechThreshold: 0.6, negativeSpeechThreshold: 0.45, redemptionMs: 500 });
export const HENRY_VAD_RECORD_OPTIONS = Object.freeze({ positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35, redemptionMs: 800 });

// getStream devolve o microfone JÁ aberto pelo Henry (o VAD não abre outro nem o fecha: pauseStream não faz nada).
export async function createHenryVad({ audioContext, getStream, onSpeechStart, onSpeechEnd, onMisfire }) {
  const vad = await loadVadLibrary();
  return vad.MicVAD.new({
    model: "v5",
    baseAssetPath: BASE,
    onnxWASMBasePath: BASE,
    audioContext,
    startOnLoad: false,
    getStream,
    pauseStream: async () => {},
    resumeStream: async () => getStream(),
    ...HENRY_VAD_BARGE_OPTIONS,
    minSpeechMs: 200,
    preSpeechPadMs: 300,
    onSpeechStart,
    onSpeechEnd,
    onVADMisfire: onMisfire,
    ortConfig: (ort) => {
      ort.env.logLevel = "error";
      ort.env.wasm.numThreads = 1;
    }
  });
}
