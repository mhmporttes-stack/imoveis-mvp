"use client";

// Preferência por dispositivo/navegador (não por conta) — cada aparelho liga
// ou desliga o próprio alerta sonoro, mesmo o controle visual vivendo em
// Gestão > Automações. localStorage é o local certo: não precisa de coluna
// nova no Supabase, e o mesmo usuário pode ter o computador da imobiliária
// com som ligado e o celular desligado.
const STORAGE_KEY = "crm_new_client_sound_enabled";

export function isNewClientSoundEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setNewClientSoundEnabled(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Sem localStorage (aba privada, storage bloqueado) — a preferência
    // simplesmente não persiste entre sessões; não é um erro fatal.
  }
}

let sharedAudioContext = null;
function getAudioContext() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioContext) sharedAudioContext = new Ctor();
  return sharedAudioContext;
}

// Toca um bipe curto (dois tons) sintetizado via Web Audio API — sem
// depender de nenhum arquivo de áudio hospedado. O primeiro play precisa
// vir de um gesto do usuário (clique em "Testar som") para o navegador
// liberar o AudioContext; como a instância é reaproveitada (singleton), uma
// vez liberado ele continua funcionando para os alertas automáticos
// seguintes, sem exigir novo clique a cada novo cliente.
export async function playNewClientSound() {
  const ctx = getAudioContext();
  if (!ctx) throw new Error("Este navegador não suporta áudio.");

  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  if (ctx.state !== "running") {
    throw new Error("O navegador bloqueou o áudio. Clique novamente ou verifique as permissões do navegador.");
  }

  const now = ctx.currentTime;
  playTone(ctx, now, 880, 0.14);
  playTone(ctx, now + 0.18, 880, 0.14);
}

function playTone(ctx, startAt, frequency, duration) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.35, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}
