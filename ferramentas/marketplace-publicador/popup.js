import { DAILY_LIMIT, REASON_LABELS, describeCheck, todayCount } from "./lib/agenda.js";

const $ = (id) => document.getElementById(id);
const fmt = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");

function line(label, value) {
  const p = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  p.append(strong, document.createTextNode(value));
  return p;
}

const chatCounts = (c) => `${c.listed ?? 0} na caixa, ${c.read ?? 0} lida(s) e enviada(s) ao CRM, ${c.created ?? 0} nova(s) no CRM, ${c.newMessages ?? 0} mensagem(ns) nova(s), ${c.sent ?? 0} resposta(s) enviada(s)${c.pending ? `, ${c.pending} pendente(s)` : ""}`;

function render({ state, config, keepAwake, chatLast, chatSkip, chatNow }) {
  const status = $("status");
  status.replaceChildren();
  const paused = state.manualPause || (state.pausedUntil && new Date(state.pausedUntil) > new Date());
  status.append(line("Situação", state.running ? `Publicando “${state.running.title}” (${state.running.step})` : paused ? (state.manualPause ? "Pausado por você" : `Pausado até ${fmt(state.pausedUntil)}`) : "Ativo"));
  if (state.pauseReason && !state.manualPause && paused) status.append(line("Motivo", state.pauseReason));
  status.append(line("Hoje", `${todayCount(state)} de ${DAILY_LIMIT} publicações`));
  status.append(line("Próxima publicação a partir de", fmt(state.nextAllowedAt)));
  status.append(line("Última verificação", `${fmt(state.lastCheckAt)} — ${describeCheck(state.lastCheckResult, state.lastCheckWaitUntil)}`));
  // Diagnóstico do Chat do Marketplace (1.8.7): o que está fazendo agora (etapa + há quanto tempo), a última rodada
  // concluída (contagens/caminho/erro — rodada pulada não apaga mais) e a última verificação pulada.
  if (chatNow) {
    status.append(line(chatNow.alive ? "Chat — agora" : "Chat — trava parada", chatNow.step));
    if (chatNow.progress) status.append(line("Chat — progresso", chatCounts(chatNow.progress)));
    if (chatNow.progress?.error) status.append(line("Chat — erro nesta rodada", chatNow.progress.error));
  }
  if (chatLast) {
    status.append(line("Chat — última sincronização", `${fmt(chatLast.at)} — ${REASON_LABELS[chatLast.result] || chatLast.result}`));
    if (chatLast.listed !== undefined) status.append(line("Chat — conversas", chatCounts(chatLast)));
    if (chatLast.steps) status.append(line("Chat — caminho", chatLast.steps));
    if (chatLast.error) status.append(line("Chat — erro", chatLast.error));
  } else if (!chatNow) {
    status.append(line("Chat do Marketplace", "ainda não sincronizou (aguarde até 1 min com o Chrome aberto)"));
  }
  if (chatSkip && (!chatLast || new Date(chatSkip.at) > new Date(chatLast.at))) {
    status.append(line("Chat — última verificação", `${fmt(chatSkip.at)} — ${REASON_LABELS[chatSkip.result] || chatSkip.result}${chatSkip.detail ? ` (${chatSkip.detail})` : ""}`));
  }
  if (!config.hasKey) status.append(line("Atenção", REASON_LABELS.sem_configuracao));
  status.append(line("Manter acordado", keepAwake === false ? "desligado (Opções)" : state.manualPause ? "solto enquanto pausado" : "ligado"));
  $("pause").textContent = paused ? "Retomar" : "Pausar";
  $("pause").dataset.paused = paused ? "1" : "";

  const list = $("history");
  list.replaceChildren();
  if (!state.history?.length) list.append(Object.assign(document.createElement("li"), { textContent: "Nada publicado ainda." }));
  for (const item of state.history || []) {
    const li = document.createElement("li");
    li.className = item.status === "published" ? "ok" : "erro";
    li.append(document.createTextNode(`${fmt(item.at)} · ${item.title} · ${item.status === "published" ? "publicado" : `falhou em ${item.step}: ${item.error}`}`));
    if (item.url) {
      const a = Object.assign(document.createElement("a"), { href: item.url, target: "_blank", textContent: " ver anúncio" });
      li.append(a);
    }
    if (item.screenshot) {
      // data: não abre em aba nova no Chrome — mostra o print aqui mesmo.
      const img = Object.assign(document.createElement("img"), { src: item.screenshot, alt: `Print da falha: ${item.step}` });
      img.className = "print";
      li.append(img);
    }
    list.append(li);
  }
}

async function refresh() {
  render(await chrome.runtime.sendMessage({ type: "mp-status" }));
}

$("pause").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "mp-pause", paused: !$("pause").dataset.paused });
  refresh();
});
// Retorno visível na hora: "Verificando…" e depois o motivo (fila vazia, pausado, intervalo até HH:MM, publicando…).
$("check").addEventListener("click", async () => {
  const feedback = $("feedback");
  $("check").disabled = true;
  feedback.textContent = REASON_LABELS.verificando;
  try {
    const result = await chrome.runtime.sendMessage({ type: "mp-check-now" });
    feedback.textContent = result?.error && !result.reason ? `Erro: ${result.error}` : `${describeCheck(result?.reason, result?.waitUntil)}${result?.title ? `: “${result.title}”` : ""}`;
  } catch (error) {
    feedback.textContent = `Erro: ${error.message}`;
  } finally {
    $("check").disabled = false;
    refresh();
  }
});

// Janela de trabalho (1.9.4): visível/oculta como o Chrome a vê (lido na página do Facebook) e botão para abri-la.
async function refreshWork() {
  try {
    const view = await chrome.runtime.sendMessage({ type: "mp-work-view" });
    $("work-text").textContent = view?.text || view?.error || "—";
    $("work").dataset.ok = view?.ok ? "1" : "";
  } catch (error) {
    $("work-text").textContent = `Erro: ${error.message}`;
  }
}

$("work-open").addEventListener("click", async () => {
  $("work-open").disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "mp-work-open" });
    if (result?.error) $("feedback").textContent = `Erro: ${result.error}`;
  } finally {
    $("work-open").disabled = false;
    refreshWork();
  }
});

refresh();
refreshWork();
setInterval(refresh, 5000);
setInterval(refreshWork, 5000);

// "Destravar sincronização" (1.8.7): solta a trava do chat e fecha a aba dela; a próxima rodada começa em até 1 min.
$("unlock").addEventListener("click", async () => {
  const feedback = $("feedback");
  $("unlock").disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "mp-chat-unlock" });
    feedback.textContent = result?.error ? `Erro: ${result.error}` : result?.released ? `Destravado (estava em: ${result.step || "?"}). Nova rodada em até 1 min.` : "Não havia trava. Nova rodada em até 1 min.";
  } catch (error) {
    feedback.textContent = `Erro: ${error.message}`;
  } finally {
    $("unlock").disabled = false;
    refresh();
  }
});

// Diagnóstico de estrutura (1.8.5): esqueleto anonimizado da caixa do Marketplace → CRM (sem nomes nem mensagens).
$("diagnose").addEventListener("click", async () => {
  const feedback = $("feedback");
  $("diagnose").disabled = true;
  feedback.textContent = "Gerando diagnóstico (até 2 min)…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "mp-diagnose" });
    feedback.textContent = result?.error ? `Erro: ${result.error}` : `Diagnóstico ${result.result}`;
  } catch (error) {
    feedback.textContent = `Erro: ${error.message}`;
  } finally {
    $("diagnose").disabled = false;
  }
});
