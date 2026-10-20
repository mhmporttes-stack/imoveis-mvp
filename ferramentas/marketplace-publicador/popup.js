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

function render({ state, config, chatLast }) {
  const status = $("status");
  status.replaceChildren();
  const paused = state.manualPause || (state.pausedUntil && new Date(state.pausedUntil) > new Date());
  status.append(line("Situação", state.running ? `Publicando “${state.running.title}” (${state.running.step})` : paused ? (state.manualPause ? "Pausado por você" : `Pausado até ${fmt(state.pausedUntil)}`) : "Ativo"));
  if (state.pauseReason && !state.manualPause && paused) status.append(line("Motivo", state.pauseReason));
  status.append(line("Hoje", `${todayCount(state)} de ${DAILY_LIMIT} publicações`));
  status.append(line("Próxima publicação a partir de", fmt(state.nextAllowedAt)));
  status.append(line("Última verificação", `${fmt(state.lastCheckAt)} — ${describeCheck(state.lastCheckResult, state.lastCheckWaitUntil)}`));
  // Diagnóstico do Chat do Marketplace (por que não chega): última sincronização, conversas, erro.
  if (chatLast) {
    status.append(line("Chat — última sincronização", `${fmt(chatLast.at)} — ${REASON_LABELS[chatLast.result] || chatLast.result}`));
    if (chatLast.result === "chat_sincronizado" || chatLast.result === "chat_erro") {
      status.append(line("Chat — conversas", `${chatLast.listed ?? 0} na caixa, ${chatLast.read ?? 0} lida(s), ${chatLast.created ?? 0} nova(s) no CRM, ${chatLast.newMessages ?? 0} mensagem(ns) nova(s), ${chatLast.sent ?? 0} resposta(s) enviada(s)`));
    }
    if (chatLast.steps) status.append(line("Chat — caminho", chatLast.steps));
    if (chatLast.error) status.append(line("Chat — erro", chatLast.error));
  } else {
    status.append(line("Chat do Marketplace", "ainda não sincronizou (aguarde até 2 min com o Chrome aberto)"));
  }
  if (!config.hasKey) status.append(line("Atenção", REASON_LABELS.sem_configuracao));
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

refresh();
setInterval(refresh, 5000);
