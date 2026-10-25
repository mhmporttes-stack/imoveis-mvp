// Regras puras das cenas de produto (2026-10-25): quando uma cena toca e como lembramos que ela já tocou.
// Só apresentação — nenhum dado novo: tudo vem do que a tela já recebeu (resposta da ação ou lista atual).
// Memória sempre com try/catch (modo privado/storage cheio não pode quebrar a tela): cai numa memória do processo.

export function createSceneMemory(getStorage) {
  const mem = new Map();
  return {
    read(key) {
      try {
        const value = getStorage()?.getItem(key);
        if (value != null) return value;
      } catch { /* storage indisponível */ }
      return mem.has(key) ? mem.get(key) : null;
    },
    write(key, value) {
      mem.set(key, value);
      try { getStorage()?.setItem(key, value); } catch { /* storage indisponível */ }
    }
  };
}

const browserStorage = (kind) => () => (typeof window === "undefined" ? null : window[kind]);
export const sessionSceneMemory = createSceneMemory(browserStorage("sessionStorage"));
export const localSceneMemory = createSceneMemory(browserStorage("localStorage"));

export function firstNameOf(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

// Dia (America/Sao_Paulo) no formato AAAA-MM-DD, só para a marca "já animei hoje".
export function saoPauloDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Cena 2: a tela VIU a mudança para o alvo (aprovado). Sem registro anterior (1ª vez que esta aba vê o cliente) não anima,
// para não encenar a lista inteira ao abrir; um registro anterior diferente do alvo + agora no alvo = mudança vista.
export function shouldPlayStatusScene({ previous, current, target, alreadyAnimated = false }) {
  if (alreadyAnimated) return false;
  if (previous == null || previous === "") return false;
  return current === target && previous !== target;
}

export function statusSceneKeys(id, status) {
  return { seen: `mm-scene-seen:${id}`, animated: `mm-scene-animated:${id}:${status}` };
}

// Cena 4: primeiro acesso do dia por usuário+data. Marca na hora (não repete ao recarregar).
export function claimDailyIntro({ memory, viewerKey, day }) {
  if (!viewerKey || !day) return false;
  const key = `mm-scene-daily-meta:${viewerKey}:${day}`;
  if (memory.read(key)) return false;
  memory.write(key, "1");
  return true;
}

// Cena 1: uma vez por venda — só quando a venda ainda não estava recebida e a resposta da ação a devolve recebida.
export function shouldPlayPaidScene({ previousStatus, nextStatus, alreadyPlayed = false }) {
  if (alreadyPlayed) return false;
  return previousStatus !== "received" && nextStatus === "received";
}

// Cena 4: quantos cartões escalonam e o atraso de cada um (≤ 40 ms entre eles, no máximo 6).
export const DAILY_STAGGER_MAX = 6;
export const DAILY_STAGGER_STEP_MS = 40;
export function dailyStaggerDelay(index) {
  if (!Number.isInteger(index) || index < 0 || index >= DAILY_STAGGER_MAX) return null;
  return index * DAILY_STAGGER_STEP_MS;
}
