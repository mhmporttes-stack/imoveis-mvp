// Voz de reserva LOCAL do Henry (fase 1.1, dono 2026-10-23 — docs/BUSINESS_RULES.md HENRY-1 "App de desktop"): quando a
// ElevenLabs e a OpenAI falham, o CRM pede speakLocal(texto) e o Piper fala no próprio PC. O texto (já validado em
// core.js validateAction) vai pela ENTRADA PADRÃO do programa — nunca por shell nem como argumento. Argumentos fixos.
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pcmToWav } = require("./core");

const PIPER_VOICE = "pt_BR-faber-medium";
const TIMEOUT_MS = 30000;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024; // ~4 min de áudio: muito acima de 1.000 caracteres

function piperFiles(modelsDir) {
  const dir = path.join(modelsDir, "piper");
  return {
    exe: path.join(dir, process.platform === "win32" ? "piper.exe" : "piper"),
    espeak: path.join(dir, "espeak-ng-data"),
    model: path.join(modelsDir, "voices", `${PIPER_VOICE}.onnx`),
    config: path.join(modelsDir, "voices", `${PIPER_VOICE}.onnx.json`)
  };
}

function piperAvailable(modelsDir) {
  const files = piperFiles(modelsDir);
  return Object.values(files).every((file) => fs.existsSync(file));
}

function sampleRateOf(configFile) {
  try {
    const rate = Number(JSON.parse(fs.readFileSync(configFile, "utf8"))?.audio?.sample_rate);
    return Number.isInteger(rate) && rate > 0 ? rate : 22050;
  } catch {
    return 22050;
  }
}

function runPiper(text, modelsDir) {
  const files = piperFiles(modelsDir);
  if (!piperAvailable(modelsDir)) return Promise.reject(new Error("piper_ausente"));
  return new Promise((resolve, reject) => {
    const child = spawn(files.exe, ["--model", files.model, "--config", files.config, "--espeak_data", files.espeak, "--output_raw", "--quiet"], {
      cwd: path.dirname(files.exe),
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "ignore"]
    });
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        reject(error);
      } else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("piper_tempo_esgotado")), TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_AUDIO_BYTES) return finish(new Error("piper_audio_grande"));
      chunks.push(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0) return finish(new Error(`piper_saiu_${code}`));
      if (!size) return finish(new Error("piper_sem_audio"));
      finish(null, pcmToWav(Buffer.concat(chunks), sampleRateOf(files.config)));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(`${text}\n`, "utf8"); // uma linha só (core.js já trocou quebras de linha por espaço)
  });
}

// Um Piper por vez (fila): duas falas ao mesmo tempo dobrariam a CPU e sairiam fora de ordem.
let queue = Promise.resolve();
function synthesize(text, modelsDir) {
  const job = queue.then(() => runPiper(text, modelsDir));
  queue = job.catch(() => {});
  return job;
}

module.exports = { PIPER_VOICE, piperFiles, piperAvailable, synthesize };
