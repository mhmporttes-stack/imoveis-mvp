// Tela de bloqueio do Henry (REGRA OFICIAL — dono, 2026-10-24, bloqueio manual; docs/BUSINESS_RULES.md HENRY-LOCK). Regras PURAS, usadas
// pelo servidor (lib/henry-lock.js, rotas do Henry) e pela tela (HenryVoiceAssistant/HenryLockScreen). Sem crypto aqui (o
// hash da senha fica em lib/henry-lock-crypto.mjs, só no servidor). A barreira de verdade é o SERVIDOR: a tela só mostra.

export const HENRY_PIN_LENGTH = 6;
export const HENRY_LOCK_COOKIE = "mm_henry_unlock";
export const HENRY_LOCK_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
// Evento da página: o cartão do Henry avisa a tela cheia quando a senha é definida ou o tempo muda (vale sem recarregar).
export const HENRY_LOCK_EVENT = "henry:lock-settings";

// Tempo sem interação (regra de 2026-10-23, SEM EFEITO desde 2026-10-24: o bloqueio é só manual). Mantido porque a coluna
// henry_lock.idle_minutes e a ação "idle" da rota ainda existem; não volte a usar para travar sem decisão do dono.
export const HENRY_LOCK_IDLE_DEFAULT_MINUTES = 10;
export const HENRY_LOCK_IDLE_OPTIONS = Object.freeze([2, 5, 10, 15, 30, 60]);

// "Depois de 5 erros, 1 min; depois 5 min; depois 15 min." A cada 5 erros seguidos (sem acerto no meio) vem uma espera:
// 5 → 1 min, 10 → 5 min, 15, 20, 25… → 15 min. O acerto zera a contagem.
export const HENRY_LOCK_ERRORS_PER_WAIT = 5;
export const HENRY_LOCK_WAITS_MS = Object.freeze([60_000, 5 * 60_000, 15 * 60_000]);

export function isValidHenryPin(pin) {
  return typeof pin === "string" && /^\d{6}$/.test(pin);
}

export function normalizeIdleMinutes(value) {
  const minutes = Number(value);
  return HENRY_LOCK_IDLE_OPTIONS.includes(minutes) ? minutes : HENRY_LOCK_IDLE_DEFAULT_MINUTES;
}

// Espera (ms) que começa depois do erro número `failures` (contagem já com este erro). 0 = sem espera.
export function henryLockWaitAfter(failures) {
  const count = Math.max(0, Math.floor(Number(failures) || 0));
  if (!count || count % HENRY_LOCK_ERRORS_PER_WAIT !== 0) return 0;
  const tier = count / HENRY_LOCK_ERRORS_PER_WAIT; // 1, 2, 3…
  return HENRY_LOCK_WAITS_MS[Math.min(tier, HENRY_LOCK_WAITS_MS.length) - 1];
}

// Segundos que ainda faltam da espera (0 = pode tentar).
export function henryLockWaitSeconds(row, now = Date.now()) {
  const until = Date.parse(row?.locked_until || "") || 0;
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

// Novo estado depois de um erro: contagem, fim da espera (ISO ou null) e se o dono deve ser avisado (começou uma espera).
export function henryLockFailure(row, now = Date.now()) {
  const failures = Math.max(0, Math.floor(Number(row?.failed_attempts) || 0)) + 1;
  const waitMs = henryLockWaitAfter(failures);
  return {
    failed_attempts: failures,
    locked_until: waitMs ? new Date(now + waitMs).toISOString() : null,
    waitMs,
    notify: waitMs > 0,
    attemptsLeft: waitMs ? 0 : HENRY_LOCK_ERRORS_PER_WAIT - (failures % HENRY_LOCK_ERRORS_PER_WAIT)
  };
}

// Estado do bloqueio para UM pedido. row = linha de henry_lock (ou null); clientLocked = a tela deste aparelho diz que está
// bloqueada (só pode deixar MAIS restrito, nunca libera).
// Bloqueio MANUAL (REGRA OFICIAL — dono, 2026-10-24, substitui "ao abrir + inatividade" de 2026-10-23): só trava quando o
// dono toca no cadeado da barra da tela cheia (ou diz "Henry, bloqueia"). Abrir a tela cheia, outro aparelho e tempo sem
// interação NÃO travam mais.
//   - sem senha definida → a tela de bloqueio não existe (comportamento de antes), configured=false;
//   - locked_at preenchido → bloqueado (todos os aparelhos, inclusive depois de recarregar) até a senha;
//   - senão → liberado. `expire` fica sempre false (nada trava sozinho); mantido no formato por compatibilidade.
export function evaluateHenryLock(row, { clientLocked = false } = {}) {
  if (!row?.pin_hash) return { configured: false, locked: false, reason: "no_pin", expire: false };
  if (row.locked_at) return { configured: true, locked: true, reason: "locked", expire: false };
  if (clientLocked) return { configured: true, locked: true, reason: "client", expire: false };
  return { configured: true, locked: false, reason: "unlocked", expire: false };
}

// Ferramentas do Henry que ficam fechadas com a tela bloqueada: todas as que LEEM o CRM e as que abrem tela/ficha (a
// navegação sairia da tela de bloqueio e "abrir_cliente" procura o cliente no banco). Música continua (dono: "toca música").
// A escrita interna confirmada (aviso de aniversariante, dono 2026-10-24) e a direta (recado à equipe, 2026-10-25) também
// leem o CRM: fechadas.
export function isHenryToolLocked(access) {
  return access === "leitura" || access === "navegacao" || access === "escrita_interna_confirmada" || access === "escrita_interna_direta";
}

// "Henry, bloqueia" / "bloqueia a tela" / "trava o Henry" (frase curta; a pergunta comum não casa).
export function isHenryLockCommand(text) {
  const clean = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(ei |oi |ok )?henr[yi] /, "")
    .replace(/(?<! o) henr[yi]$/, "") // "trava o Henry" mantém o "o Henry"
    .replace(/ (por favor|pra mim|ai)$/, "");
  return /^(pode )?(bloqueia|bloquear|bloqueie|trava|travar|trave)( (a tela|o henr[yi]|tudo|aqui|isso|a tela cheia))?$/.test(clean);
}

// Frases do "pede a senha" (dono: "Pra isso preciso que você desbloqueie com a senha", variando a frase).
export const HENRY_LOCKED_PHRASES = Object.freeze([
  "Pra isso preciso que você desbloqueie com a senha.",
  "Essa eu só falo depois da senha. Desbloqueia aí embaixo.",
  "Tá bloqueado. Digita a senha que eu te conto.",
  "Opa, dado do CRM só com a tela desbloqueada. Manda a senha.",
  "Primeiro a senha, depois os números. Combinado?",
  "Com a tela travada eu não abro o CRM. Desbloqueia com a senha.",
  "Segura aí: preciso da senha pra entrar nessa.",
  "Isso fica guardado até você desbloquear com a senha."
]);

export const HENRY_LOCK_DONE_PHRASES = Object.freeze(["Pronto, travei a tela.", "Fechado, tela bloqueada.", "Bloqueado. Pra ver o CRM, só com a senha."]);

export function pickHenryLockedPhrase(recent = [], random = Math.random, bank = HENRY_LOCKED_PHRASES) {
  const fresh = bank.filter((item) => !recent.includes(item));
  const list = fresh.length ? fresh : bank;
  return list[Math.floor(random() * list.length) % list.length];
}

// Instrução ao modelo enquanto bloqueado (parte variável do prompt): conversa, piada, música e internet seguem; dado do
// CRM, não — e ele nem tem as ferramentas do CRM nesse estado (lib/henry-voice.js).
export function buildHenryLockNote(example = HENRY_LOCKED_PHRASES[0]) {
  return `TELA BLOQUEADA AGORA: você continua conversando, contando piada, tocando música e pesquisando na internet normalmente, mas NÃO fala NENHUM dado do CRM (clientes, corretores, conversas, presença, financeiro, avisos, números, metas, ranking, agenda) nem do que foi dito antes do bloqueio, nem abre telas. Se pedirem algo assim, não responda o dado: peça para desbloquear com a senha, numa frase curta e variada (ex.: "${example}"). Nunca peça para falar a senha em voz alta: ela é digitada na tela.`;
}

// Mensagem da espera depois de vários erros.
export function henryLockWaitMessage(seconds) {
  const minutes = Math.ceil(Math.max(0, seconds) / 60);
  return minutes <= 1 ? "Muitas tentativas. Espere 1 minuto para tentar de novo." : `Muitas tentativas. Espere ${minutes} minutos para tentar de novo.`;
}

// Cena do desbloqueio (dono, 2026-10-24): os asteriscos viram caracteres embaralhando (fonte mono) e travam um a um da
// esquerda para a direita num símbolo NEUTRO, abrindo os cadeados. NUNCA a senha: o conjunto não tem dígito nenhum e o
// fim é sempre "✓". Tempos: começa a travar em 280 ms, um a cada 120 ms, segura 250 ms (≈ 1,1 s; a varredura do anel
// completa ~1,7 s). prefers-reduced-motion: todos travados na hora e 300 ms no total.
export const HENRY_UNLOCK_GLYPHS = Object.freeze([..."#%&@$?!<>/{}[]=+*~^ΣΔΞΛΩ▓▒░◆◇"]);
export const HENRY_UNLOCK_DONE_GLYPH = "✓";
export const HENRY_UNLOCK_TIMING = Object.freeze({ firstLockMs: 280, stepMs: 120, holdMs: 250, reducedMs: 300 });

export function henryUnlockDuration({ reduced = false, length = HENRY_PIN_LENGTH } = {}) {
  const t = HENRY_UNLOCK_TIMING;
  return reduced ? t.reducedMs : t.firstLockMs + (length - 1) * t.stepMs + t.holdMs;
}

// Quadro da cena em `elapsedMs`: [{ char, locked }] para os 6 risquinhos.
export function henryUnlockFrame(elapsedMs, { reduced = false, random = Math.random, length = HENRY_PIN_LENGTH } = {}) {
  const t = HENRY_UNLOCK_TIMING;
  return Array.from({ length }, (_, index) => {
    const locked = reduced || elapsedMs >= t.firstLockMs + index * t.stepMs;
    return { locked, char: locked ? HENRY_UNLOCK_DONE_GLYPH : HENRY_UNLOCK_GLYPHS[Math.floor(random() * HENRY_UNLOCK_GLYPHS.length) % HENRY_UNLOCK_GLYPHS.length] };
  });
}
