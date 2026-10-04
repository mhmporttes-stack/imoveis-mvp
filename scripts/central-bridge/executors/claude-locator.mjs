// Localiza o Claude Code CLI oficial no PC, sem executar nada e sem rede (so sistema de arquivos).
// O app do Claude (MSIX) guarda o CLI em `...\claude-code\<semver>\<hash>\claude.exe` e a versao muda a cada
// atualizacao; por isso o caminho e resolvido a CADA execucao, nao fixado.
//
// Ordem: (a) CENTRAL_CLAUDE_BIN, se for caminho absoluto valido (arquivo claude.exe/claude dentro de pasta `claude-code`);
//        (b) varredura de %APPDATA%\Claude\claude-code e de %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude-code,
//            maior versao semver (comparacao numerica); sem fallback para `claude` do PATH;
//        (c) nada achado -> { ok:false, reason } (quem chama faz a falha tratada).
// CENTRAL_CLAUDE_BIN invalido NAO falha: cai para a varredura (o motivo vai em `skipped`).
import * as nodeFs from "node:fs";
import { basename, isAbsolute, join, sep } from "node:path";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const BIN_NAMES = new Set(["claude.exe", "claude"]);

export function compareSemver(a, b) {
  const pa = a.match(SEMVER);
  const pb = b.match(SEMVER);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d;
  }
  return 0;
}

const inClaudeCodeDir = (p) => p.split(/[\\/]+/).slice(0, -1).some((seg) => seg.toLowerCase() === "claude-code");
const isBinName = (p) => BIN_NAMES.has(basename(p).toLowerCase());

function isRegularFile(fs, p) {
  try {
    return fs.lstatSync(p).isFile();
  } catch {
    return false;
  }
}

// Valida (a): caminho absoluto, nome claude.exe/claude, dentro de `claude-code`, arquivo regular; realpath continua valido.
function validateConfigured(fs, p) {
  if (typeof p !== "string" || !p.trim()) return { ok: false, reason: "vazio" };
  const path = p.trim();
  if (!isAbsolute(path)) return { ok: false, reason: "nao e caminho absoluto" };
  if (!isBinName(path)) return { ok: false, reason: "nome nao e claude.exe/claude" };
  if (!inClaudeCodeDir(path)) return { ok: false, reason: "fora de pasta claude-code" };
  let real;
  try {
    real = fs.realpathSync(path);
  } catch {
    return { ok: false, reason: "arquivo inexistente" };
  }
  if (!isRegularFile(fs, real)) return { ok: false, reason: "nao e arquivo" };
  if (!isBinName(real) || !inClaudeCodeDir(real)) return { ok: false, reason: "link aponta para fora da arvore claude-code" };
  return { ok: true, path: real };
}

export function candidateRoots(env, fs) {
  const roots = [];
  if (env.APPDATA) roots.push(join(env.APPDATA, "Claude", "claude-code"));
  if (env.LOCALAPPDATA) {
    const packages = join(env.LOCALAPPDATA, "Packages");
    let names = [];
    try {
      names = fs.readdirSync(packages, { withFileTypes: true }).filter((e) => e.isDirectory() && /^Claude_/i.test(e.name)).map((e) => e.name);
    } catch {
      names = [];
    }
    for (const n of names.sort()) roots.push(join(packages, n, "LocalCache", "Roaming", "Claude", "claude-code"));
  }
  return roots;
}

// Varre uma raiz -> lista { version, path }. So diretorios reais (links simbolicos ignorados).
function scanRoot(fs, root) {
  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return [];
  }
  const out = [];
  let versions = [];
  try {
    versions = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && SEMVER.test(e.name));
  } catch {
    return [];
  }
  for (const v of versions) {
    let hashes = [];
    try {
      hashes = fs.readdirSync(join(root, v.name), { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      continue;
    }
    for (const h of hashes.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const exe = join(root, v.name, h.name, "claude.exe");
      if (!isRegularFile(fs, exe)) continue;
      let real;
      try {
        real = fs.realpathSync(exe);
      } catch {
        continue;
      }
      // continua dentro da raiz esperada e no formato <raiz>\<semver>\<hash>\claude.exe
      if (!real.toLowerCase().startsWith(realRoot.toLowerCase() + sep)) continue;
      const rel = real.slice(realRoot.length + 1).split(sep);
      if (rel.length !== 3 || !SEMVER.test(rel[0]) || rel[2].toLowerCase() !== "claude.exe") continue;
      out.push({ version: v.name, path: real });
    }
  }
  return out;
}

export function resolveClaudeBin({ configured = "", env = process.env, fs = nodeFs } = {}) {
  const skipped = [];
  if (configured && configured.trim() && configured.trim().toLowerCase() !== "claude") {
    const v = validateConfigured(fs, configured);
    if (v.ok) return { ok: true, path: v.path, source: "CENTRAL_CLAUDE_BIN", version: null, skipped };
    skipped.push(`CENTRAL_CLAUDE_BIN ignorado (${v.reason})`);
  }
  const found = candidateRoots(env, fs).flatMap((r) => scanRoot(fs, r));
  if (found.length === 0) {
    return { ok: false, reason: "Claude Code nao encontrado no PC (nenhuma versao em claude-code\\<versao>\\<hash>\\claude.exe).", skipped };
  }
  found.sort((a, b) => compareSemver(b.version, a.version)); // estavel: empate mantem a ordem das raizes
  return { ok: true, path: found[0].path, source: "varredura", version: found[0].version, skipped };
}
