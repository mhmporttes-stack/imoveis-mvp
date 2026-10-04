import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareSemver, resolveClaudeBin } from "../scripts/central-bridge/executors/claude-locator.mjs";
import { createClaudeExecutor } from "../scripts/central-bridge/executors/claude.mjs";

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), "claude-loc-"));
  const appdata = join(base, "Roaming");
  const local = join(base, "Local");
  mkdirSync(appdata, { recursive: true });
  mkdirSync(local, { recursive: true });
  const env = { APPDATA: appdata, LOCALAPPDATA: local };
  const root = join(appdata, "Claude", "claude-code");
  const msix = join(local, "Packages", "Claude_abc123", "LocalCache", "Roaming", "Claude", "claude-code");
  const mk = (r, ver, hash, name = "claude.exe") => {
    const d = join(r, ver, hash);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, name), "x");
    return join(d, name);
  };
  return { base, env, root, msix, mk, done: () => rmSync(base, { recursive: true, force: true }) };
}

test("semver numerico: 2.10.0 > 2.1.286 > 2.1.9 (nao alfabetico)", () => {
  const s = sandbox();
  try {
    s.mk(s.root, "2.1.9", "aaa");
    s.mk(s.root, "2.1.286", "bbb");
    s.mk(s.root, "2.10.0", "ccc");
    const r = resolveClaudeBin({ env: s.env });
    assert.equal(r.ok, true);
    assert.equal(r.version, "2.10.0");
    assert.match(r.path, /2\.10\.0[\\/]ccc[\\/]claude\.exe$/);
    assert.ok(compareSemver("2.1.286", "2.1.9") > 0 && compareSemver("2.10.0", "2.9.99") > 0);
  } finally {
    s.done();
  }
});

test("varre tambem o caminho virtualizado do MSIX e escolhe a maior versao entre as raizes", () => {
  const s = sandbox();
  try {
    s.mk(s.root, "2.1.9", "aaa");
    s.mk(s.msix, "2.1.286", "bbb");
    const r = resolveClaudeBin({ env: s.env });
    assert.equal(r.version, "2.1.286");
    assert.match(r.path, /Claude_abc123/);
  } finally {
    s.done();
  }
});

test("executavel do Desktop ao lado, .cmd/.ps1 e pasta sem claude.exe sao ignorados", () => {
  const s = sandbox();
  try {
    mkdirSync(join(s.env.APPDATA, "Claude"), { recursive: true });
    writeFileSync(join(s.env.APPDATA, "Claude", "Claude.exe"), "desktop");
    mkdirSync(join(s.root, "9.9.9", "hash1"), { recursive: true });
    writeFileSync(join(s.root, "9.9.9", "hash1", "claude.cmd"), "x");
    writeFileSync(join(s.root, "9.9.9", "hash1", "claude.ps1"), "x");
    s.mk(s.root, "2.1.286", "ok");
    const r = resolveClaudeBin({ env: s.env });
    assert.equal(r.version, "2.1.286");
    assert.match(r.path, /2\.1\.286[\\/]ok[\\/]claude\.exe$/);
  } finally {
    s.done();
  }
});

test("versao mais nova sem hash/claude.exe: usa a proxima que tem; nada achado = falha tratada sem PATH", () => {
  const s = sandbox();
  const empty = sandbox();
  try {
    mkdirSync(join(s.root, "3.0.0"), { recursive: true }); // sem hash
    mkdirSync(join(s.root, "2.5.0", "h"), { recursive: true }); // hash sem claude.exe
    s.mk(s.root, "2.1.286", "ok");
    assert.equal(resolveClaudeBin({ env: s.env }).version, "2.1.286");
    mkdirSync(join(empty.root, "3.0.0"), { recursive: true });
    const r = resolveClaudeBin({ env: { ...empty.env, PATH: "C:/qualquer" } });
    assert.equal(r.ok, false);
    assert.match(r.reason, /nao encontrado/);
    assert.equal(resolveClaudeBin({ env: {} }).ok, false);
  } finally {
    s.done();
    empty.done();
  }
});

test("CENTRAL_CLAUDE_BIN valido (absoluto, claude.exe, dentro de claude-code) tem prioridade sobre versao maior", () => {
  const s = sandbox();
  try {
    const pinned = s.mk(s.root, "2.1.9", "aaa");
    s.mk(s.root, "2.10.0", "ccc");
    const r = resolveClaudeBin({ configured: pinned, env: s.env });
    assert.equal(r.source, "CENTRAL_CLAUDE_BIN");
    assert.match(r.path, /2\.1\.9/);
  } finally {
    s.done();
  }
});

test("CENTRAL_CLAUDE_BIN invalido cai para a varredura (nao falha) e registra o motivo", () => {
  const s = sandbox();
  try {
    s.mk(s.root, "2.1.286", "ok");
    const outside = join(s.base, "outro");
    mkdirSync(outside);
    writeFileSync(join(outside, "claude.exe"), "x");
    writeFileSync(join(s.base, "claude-code.cmd"), "x");
    writeFileSync(join(s.root, "2.1.286", "ok", "claude.bat"), "x");
    const casos = [
      "relativo\\claude.exe",
      join(outside, "claude.exe"), // fora de claude-code
      join(s.root, "2.1.286", "ok", "inexistente.exe"),
      join(s.root, "2.1.286", "ok", "claude.exe") + "x",
      join(s.base, "claude-code.cmd"),
      join(s.root, "2.1.286", "ok", "claude.bat"),
      join(s.root, "2.1.286", "ok") // pasta
    ];
    for (const c of casos) {
      const r = resolveClaudeBin({ configured: c, env: s.env });
      assert.equal(r.ok, true, c);
      assert.equal(r.source, "varredura", c);
      assert.equal(r.skipped.length, 1, c);
    }
    // "claude" puro (PATH) nunca e usado: varredura, sem erro
    assert.equal(resolveClaudeBin({ configured: "claude", env: s.env }).source, "varredura");
  } finally {
    s.done();
  }
});

test("link simbolico que aponta para fora da arvore claude-code e rejeitado (quando o SO permite criar)", (t) => {
  const s = sandbox();
  try {
    const outside = join(s.base, "fora");
    mkdirSync(outside);
    writeFileSync(join(outside, "claude.exe"), "x");
    mkdirSync(join(s.root, "9.0.0", "lnk"), { recursive: true });
    try {
      symlinkSync(join(outside, "claude.exe"), join(s.root, "9.0.0", "lnk", "claude.exe"));
    } catch {
      t.skip("sem permissao para criar link simbolico");
      return;
    }
    s.mk(s.root, "2.1.286", "ok");
    assert.equal(resolveClaudeBin({ env: s.env }).version, "2.1.286");
    const r = resolveClaudeBin({ configured: join(s.root, "9.0.0", "lnk", "claude.exe"), env: s.env });
    assert.equal(r.source, "varredura");
  } finally {
    s.done();
  }
});

test("executor com localizador: usa o caminho resolvido a cada execucao, loga o caminho e falha clara sem binario", async () => {
  const calls = [];
  const logs = [];
  let result = { ok: true, path: "C:/x/claude-code/2.1.286/h/claude.exe", source: "varredura", version: "2.1.286", skipped: [] };
  const runner = async ({ bin }) => {
    calls.push(bin);
    return { code: 0, stdout: JSON.stringify({ result: "ok" }), timedOut: false };
  };
  const ex = createClaudeExecutor({ enabled: true, useLocator: true, locator: () => result, runner, env: { PATH: "/bin" }, log: (m) => logs.push(m) });
  const task = { task_id: "12345678-aaaa", tipo: "consulta", payload: { tipo: "consulta", instruction_text: "oi" } };
  assert.equal(await ex.execute(task), "ok");
  result = { ...result, path: "C:/x/claude-code/2.10.0/h/claude.exe", version: "2.10.0" };
  await ex.execute(task);
  assert.deepEqual(calls, ["C:/x/claude-code/2.1.286/h/claude.exe", "C:/x/claude-code/2.10.0/h/claude.exe"]);
  assert.ok(logs.some((l) => l.includes("binario C:/x/claude-code/2.10.0/h/claude.exe")));
  result = { ok: false, reason: "Claude Code nao encontrado no PC (teste).", skipped: [] };
  await assert.rejects(ex.execute(task), /nao encontrado/);
  assert.equal(calls.length, 2); // nao tentou rodar nada
});
