// Baixa os modelos de voz do app (fase 1.1) para desktop-app/models/ — fora do git; entram no pacote por
// "extraResources". Cada download tem SHA-256 FIXO: arquivo diferente do conferido em 2026-10-23 = erro e nada é usado.
// Roda sozinho antes de "dist:portable"/"dist:nsis" (Windows ou Linux). Já baixado e conferido = pula.
//   Vosk vosk-model-small-pt-0.3 (Apache-2.0) · Piper 2023.11.14-2 para Windows (MIT; inclui espeak-ng, GPL-3.0)
//   · voz pt_BR-faber-medium (rhasspy/piper-voices, MIT; dados CC0).
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const MODELS = path.join(__dirname, "..", "models");
const TMP = path.join(MODELS, ".download");
const HF = "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/pt/pt_BR/faber/medium";

const ITEMS = [
  {
    name: "vosk-model-small-pt-0.3.zip",
    url: "https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip",
    sha256: "6e1ce909032e1afa7a88e68a3d628ecafff302bdf195befab308826c395e93b7",
    done: "vosk-model-small-pt-0.3.tar.gz",
    install: (file) => {
      // O Vosk do app lê .tar.gz com a pasta do modelo dentro.
      extractZip(file, TMP);
      execFileSync("tar", ["-czf", path.join(MODELS, "vosk-model-small-pt-0.3.tar.gz"), "-C", TMP, "vosk-model-small-pt-0.3"], { stdio: "inherit" });
    }
  },
  {
    name: "piper_windows_amd64.zip",
    url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
    sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea",
    done: path.join("piper", "piper.exe"),
    install: (file) => extractZip(file, MODELS) // a pasta "piper/" vem dentro do zip
  },
  {
    name: "pt_BR-faber-medium.onnx",
    url: `${HF}/pt_BR-faber-medium.onnx`,
    sha256: "858555e3a064209c57088fe6bd70c4c3dc54d03eaa00c45d5ecaf43a33f95aa7",
    done: path.join("voices", "pt_BR-faber-medium.onnx"),
    install: (file) => copyTo(file, path.join(MODELS, "voices", "pt_BR-faber-medium.onnx"))
  },
  {
    name: "pt_BR-faber-medium.onnx.json",
    url: `${HF}/pt_BR-faber-medium.onnx.json`,
    sha256: "7e694de195ae3fc36dd732c445eb04fb49b649854893cb5506b978f0d50a1d6f",
    done: path.join("voices", "pt_BR-faber-medium.onnx.json"),
    install: (file) => copyTo(file, path.join(MODELS, "voices", "pt_BR-faber-medium.onnx.json"))
  }
];

function extractZip(file, target) {
  fs.mkdirSync(target, { recursive: true });
  // Windows 10+: tar.exe (bsdtar) abre zip. Linux: unzip.
  if (process.platform === "win32") execFileSync("tar", ["-xf", file, "-C", target], { stdio: "inherit" });
  else execFileSync("unzip", ["-q", "-o", file, "-d", target], { stdio: "inherit" });
}

function copyTo(file, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
}

function sha256Of(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function download(item) {
  const file = path.join(TMP, item.name);
  if (fs.existsSync(file) && sha256Of(file) === item.sha256) return file;
  console.log(`Baixando ${item.name}...`);
  const response = await fetch(item.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${item.name}: HTTP ${response.status}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  const hash = sha256Of(file);
  if (hash !== item.sha256) {
    fs.rmSync(file, { force: true });
    throw new Error(`${item.name}: SHA-256 diferente do esperado (${hash}). Nada foi instalado.`);
  }
  return file;
}

async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  const marker = path.join(MODELS, "modelos.ok");
  const expected = ITEMS.map((item) => `${item.name} ${item.sha256}`).join("\n");
  const ready = ITEMS.every((item) => fs.existsSync(path.join(MODELS, item.done)));
  if (ready && fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === expected) {
    console.log("Modelos de voz já baixados e conferidos.");
    return;
  }
  for (const item of ITEMS) item.install(await download(item));
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.writeFileSync(marker, expected);
  console.log("Modelos de voz prontos em desktop-app/models.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
