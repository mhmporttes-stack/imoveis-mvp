// Worktree git isolada para tarefas de ESCRITA aprovadas da ponte ChatGPT -> Central.
// Segundo (e ultimo) arquivo da ponte autorizado a abrir processo (o primeiro e executors/claude.mjs);
// o teste estatico proibe isso em qualquer outro arquivo, inclusive no poller.
//
// Modelo de seguranca:
//  - cada tarefa roda numa worktree NOVA, FORA do checkout em uso (o poller roda do checkout principal),
//    criada a partir de origin/main, na branch `central/<id8>`;
//  - quem comita e o CODIGO daqui (nunca o Claude): `git add`/`git commit` sem shell, argumentos em array,
//    sem hooks (core.hooksPath vazio + --no-verify), depois de conferir os caminhos alterados contra a denylist;
//  - os comandos git passam por uma ALLOWLIST FECHADA (assertSafeGitArgs): nada de publicar, mesclar, reescrever
//    historico, mexer em configuracao ou remotos. Publicar continua sendo ato humano;
//  - limpeza so dentro da pasta-base das worktrees e so de pastas `central-*`.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export const MAX_CHANGED_FILES = 100;
export const GIT_TIMEOUT_MS = 120_000;
export const GIT_MAX_STDOUT = 1_000_000;
const TASK_ID8 = /^[0-9a-f]{8}$/;
const BRANCH_RE = /^central\/[0-9a-f]{8}(-[0-9]{1,2})?$/;
const SHA_RE = /^[0-9a-f]{40}$/;

export const defaultBaseDir = () => join(homedir(), ".central-bridge-worktrees");

// Caminhos (relativos a raiz da worktree) que a escrita automatica NUNCA pode alterar. Comparacao sem diferenciar maiusculas.
// scripts/central-bridge/** = poller, executor, trava, launcher de escrita: alterar o proprio executor e o pior caso.
export const WRITE_DENIED_PATTERNS = Object.freeze([
  "**/.env", "**/.env.*", "**/*.env", "**/.central-bridge*",
  "**/.claude/settings*", "**/.claude/hooks/**", "**/.claude.json", "**/.credentials.json", "**/credentials*", "**/.mcp.json",
  "**/.git/**", "**/.git", "**/.gitmodules", "**/node_modules/**", "**/.vercel/**", "**/supabase/.temp/**", "**/scratch/**",
  "**/*.pem", "**/*.key", "**/*.pfx", "**/id_rsa*", "**/id_ed25519*", "**/.npmrc", "**/.netrc",
  "scripts/central-bridge/**", "**/iniciar-poller-central*"
]);

function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (c === "*") out += "[^/]*";
    else out += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}
const DENIED_RES = WRITE_DENIED_PATTERNS.map(globToRegExp);

export function normalizeRelPath(p) {
  return String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}
// Verdadeiro se o caminho esta protegido (ou e suspeito: absoluto, com `..`, vazio).
export function isPathDenied(rel) {
  const p = normalizeRelPath(rel);
  if (!p || p.startsWith("/") || /^[a-z]:/i.test(p) || p.split("/").includes("..")) return true;
  return DENIED_RES.some((re) => re.test(p));
}

// Chaves de configuracao que o codigo pode passar com -c (nada alem disto).
const ALLOWED_CONFIG_KEYS = new Set(["core.hooksPath", "user.name", "user.email", "commit.gpgsign"]);

// ALLOWLIST FECHADA de comandos git. Qualquer outra forma lanca erro antes de abrir processo.
export function assertSafeGitArgs(args) {
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string" || a.includes("\0"))) throw new Error("git: argumentos invalidos");
  const rest = [...args];
  while (rest[0] === "-c") {
    const kv = rest[1] || "";
    const key = kv.split("=")[0];
    if (!ALLOWED_CONFIG_KEYS.has(key)) throw new Error("git: configuracao nao permitida");
    rest.splice(0, 2);
  }
  const [sub, ...a] = rest;
  const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  const ok = (() => {
    switch (sub) {
      case "fetch": return eq(a, ["--no-tags", "--quiet", "origin", "main"]);
      case "worktree":
        if (a[0] === "add") return a.length === 5 && a[1] === "-b" && BRANCH_RE.test(a[2]) && a[3].length > 0 && !a[3].startsWith("-") && a[4] === "origin/main";
        if (a[0] === "remove") return a.length === 3 && a[1] === "--force" && !a[2].startsWith("-");
        return eq(a, ["prune"]);
      case "branch": return a.length === 2 && a[0] === "-D" && BRANCH_RE.test(a[1]);
      case "rev-parse":
        return eq(a, ["HEAD"]) || (a.length === 3 && a[0] === "--verify" && a[1] === "--quiet" && /^refs\/heads\/central\/[0-9a-f]{8}(-[0-9]{1,2})?$/.test(a[2]));
      case "status": return eq(a, ["--porcelain=v1", "-z", "--untracked-files=all"]);
      case "add": return eq(a, ["-A"]);
      case "diff":
        return eq(a, ["--cached", "--name-only", "--no-renames", "-z"]) ||
          (a.length === 4 && a[0] === "--stat" && a[1] === "--no-renames" && SHA_RE.test(a[2]) && SHA_RE.test(a[3])) ||
          (a.length === 3 && a[0] === "--stat" && a[1] === "--no-renames" && a[2] === "--cached");
      case "log": return a.length === 3 && a[0] === "-1" && a[1] === "--format=%P" && a[2] === "HEAD";
      case "commit":
        return a.length === 3 && a[0] === "--no-verify" && a[1] === "-m" && a[2].length > 0;
      default: return false;
    }
  })();
  if (!ok) throw new Error("git: comando nao permitido");
}

const GIT_ENV_ALLOWLIST = ["PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "LANG", "LC_ALL"];
export function buildGitEnv(baseEnv = process.env) {
  const out = {};
  for (const n of GIT_ENV_ALLOWLIST) if (baseEnv[n] !== undefined) out[n] = String(baseEnv[n]);
  out.GIT_TERMINAL_PROMPT = "0";
  out.GCM_INTERACTIVE = "never";
  return out;
}

// Runner real do git: spawn sem shell. Nunca devolve stderr ao chamador (so contagem de codigo).
export function createGitRunner({ gitBin = "git", spawnImpl = spawn, env = process.env, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  return function runGit(args, { cwd }) {
    assertSafeGitArgs(args);
    return new Promise((resolvePromise) => {
      let settled = false;
      let timer;
      const done = (r) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise(r);
      };
      let child;
      try {
        child = spawnImpl(gitBin, args, { cwd, env: buildGitEnv(env), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        return done({ code: null, stdout: "", spawnError: e?.code || "SPAWN" });
      }
      const chunks = [];
      let bytes = 0;
      let overflow = false;
      const kill = () => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ja encerrado
        }
      };
      timer = setTimeout(() => {
        kill();
        done({ code: null, stdout: "", timedOut: true });
      }, timeoutMs);
      child.stdout?.on("data", (d) => {
        bytes += d.length;
        if (bytes > GIT_MAX_STDOUT) {
          overflow = true;
          kill();
          return;
        }
        chunks.push(d);
      });
      child.stderr?.on("data", () => {});
      child.on("error", (e) => done({ code: null, stdout: "", spawnError: e?.code || "SPAWN" }));
      child.on("close", (code) => done({ code, stdout: Buffer.concat(chunks).toString("utf8"), overflow }));
    });
  };
}

export const taskId8 = (taskId) => {
  const id8 = String(taskId ?? "").toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 8);
  return TASK_ID8.test(id8) ? id8 : null;
};

function isInside(base, target) {
  const rel = relative(base, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function createWorktreeManager({
  repoRoot,
  baseDir = defaultBaseDir(),
  runGit = createGitRunner(),
  fsImpl = { existsSync, mkdirSync, rmSync, realpathSync },
  log = () => {}
} = {}) {
  if (!repoRoot) throw new Error("worktree: repoRoot obrigatorio");
  const base = resolve(baseDir);
  const must = async (args, cwd, what) => {
    const r = await runGit(args, { cwd });
    if (r.timedOut) throw new Error(`git ${what}: tempo limite`);
    if (r.spawnError) throw new Error(r.spawnError === "ENOENT" ? "git nao encontrado no PC (CENTRAL_GIT_BIN)." : `git ${what}: falha ao iniciar`);
    if (r.overflow) throw new Error(`git ${what}: saida acima do limite`);
    if (r.code !== 0) throw new Error(`git ${what} falhou (codigo ${r.code ?? "?"})`);
    return r.stdout;
  };
  const dirFor = (id8, attempt) => resolve(base, `central-${id8}-${attempt}`);
  const safeRemoveDir = (dir) => {
    // So apaga dentro da pasta-base e so pastas central-*. Nunca fora disso.
    const target = resolve(dir);
    if (!isInside(base, target) || !/^central-[0-9a-f]{8}-[0-9]{1,2}$/.test(target.slice(base.length + 1))) {
      throw new Error("worktree: limpeza recusada fora da pasta-base");
    }
    if (fsImpl.existsSync(target)) fsImpl.rmSync(target, { recursive: true, force: true });
  };

  return {
    base,
    // Cria a worktree nova. Retorna {dir, branch, id8, attempt}.
    async prepare(task) {
      const id8 = taskId8(task?.task_id);
      if (!id8) throw new Error("worktree: task_id invalido");
      const attempt = Math.min(Math.max(Number(task?.attempts) || 1, 1), 99);
      const branch = attempt > 1 ? `central/${id8}-${attempt}` : `central/${id8}`;
      const dir = dirFor(id8, attempt);
      fsImpl.mkdirSync(base, { recursive: true });
      fsImpl.mkdirSync(join(base, "_nohooks"), { recursive: true });
      if (fsImpl.existsSync(dir)) {
        // sobra de execucao anterior interrompida (nome e local nossos): remove antes de recriar
        try {
          await runGit(["worktree", "remove", "--force", dir], { cwd: repoRoot });
        } catch {
          // segue para a remocao direta
        }
        safeRemoveDir(dir);
        await runGit(["worktree", "prune"], { cwd: repoRoot });
      }
      await must(["fetch", "--no-tags", "--quiet", "origin", "main"], repoRoot, "fetch");
      const exists = await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repoRoot });
      if (exists.code === 0) throw new Error(`worktree: a branch ${branch} ja existe`);
      await must(["worktree", "add", "-b", branch, dir, "origin/main"], repoRoot, "worktree add");
      log(`worktree: ${branch} em ${dir}`);
      return { dir, branch, id8, attempt };
    },

    // Depois que o Claude terminou: confere caminhos, comita (so o codigo comita) e descreve o resultado.
    async finalize(wt, task) {
      const status = await must(["status", "--porcelain=v1", "-z", "--untracked-files=all"], wt.dir, "status");
      if (!status.replace(/\0/g, "").trim()) return { changed: false, branch: wt.branch };
      await must(["add", "-A"], wt.dir, "add");
      const names = (await must(["diff", "--cached", "--name-only", "--no-renames", "-z"], wt.dir, "diff"))
        .split("\0").filter(Boolean);
      const blocked = names.filter(isPathDenied);
      if (blocked.length) {
        const err = new Error(`Escrita bloqueada: alteracao em caminho protegido (${blocked.length} arquivo(s): ${blocked.slice(0, 3).map((b) => b.slice(0, 80)).join(", ")}). Nada foi commitado.`);
        err.blocked = true;
        throw err;
      }
      if (names.length > MAX_CHANGED_FILES) throw new Error(`Escrita bloqueada: ${names.length} arquivos alterados (limite ${MAX_CHANGED_FILES}). Nada foi commitado.`);
      const id8 = wt.id8;
      const message = `Central: tarefa ${id8} (escrita aprovada)\n\nGerado pelo executor da ponte em worktree isolada. Nao publicado: revisar antes de mesclar.`;
      const cfg = [
        "-c", `core.hooksPath=${join(base, "_nohooks")}`,
        "-c", "user.name=Central Executor",
        "-c", "user.email=central-executor@localhost",
        "-c", "commit.gpgsign=false"
      ];
      await must([...cfg, "commit", "--no-verify", "-m", message], wt.dir, "commit");
      const commit = (await must(["rev-parse", "HEAD"], wt.dir, "rev-parse")).trim();
      if (!SHA_RE.test(commit)) throw new Error("git rev-parse: saida inesperada");
      const parent = (await must(["log", "-1", "--format=%P", "HEAD"], wt.dir, "log")).trim();
      let stat = "";
      if (SHA_RE.test(parent)) stat = (await must(["diff", "--stat", "--no-renames", parent, commit], wt.dir, "diff")).trim();
      return { changed: true, branch: wt.branch, commit, stat, files: names.length };
    },

    // Remove a worktree (e a branch, se pedido). Nunca apaga fora da pasta-base. Falhas viram log, nao excecao.
    async cleanup(wt, { dropBranch }) {
      try {
        const r = await runGit(["worktree", "remove", "--force", wt.dir], { cwd: repoRoot });
        if (r.code !== 0) safeRemoveDir(wt.dir);
        await runGit(["worktree", "prune"], { cwd: repoRoot });
        if (dropBranch) await runGit(["branch", "-D", wt.branch], { cwd: repoRoot });
      } catch (e) {
        log(`worktree: limpeza incompleta (${String(e?.message || e).slice(0, 120)})`);
      }
    }
  };
}
