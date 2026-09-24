// Núcleo PURO dos Fluxos do WhatsApp (sem banco, sem rede): modelo do grafo,
// validação, gatilhos, montagem das mensagens da Meta e o executor passo a
// passo. Roda no servidor (lib/whatsapp-flows.js injeta envio/ações/condições
// reais) e no navegador (Pré-visualizar, com dependências simuladas) — por
// isso é .mjs sem "server-only". Testes: tests/whatsapp-flow-core.test.mjs.

export const LIMITS = {
  bodyText: 1024,
  footer: 60,
  buttonTitle: 20,
  maxButtons: 3,
  listButton: 20,
  listItemTitle: 24,
  listItemDescription: 72,
  maxListItems: 10,
  linkLabel: 20,
  maxSteps: 30,
  maxSendsPerRun: 8,
  maxRetries: 2,
  maxDelayMinutes: 23 * 60,
  maxKeywords: 30
};

export const NODE_TYPES = ["start", "message", "input", "action", "condition", "delay"];
export const MESSAGE_MODES = ["text", "buttons", "list", "link"];
export const ACTION_TYPES = ["roulette", "tag", "handoff", "finish", "stop"];
export const CONDITION_KINDS = ["business_hours", "is_client", "has_broker", "ad_origin"];
export const TRIGGER_TYPES = ["keyword", "first_message", "ad_referral", "any_message"];

export const START_NODE_ID = "start";

export const DEFAULT_TRIGGER = { type: "keyword", keywords: [], match: "contains", cooldownHours: 0 };

export function emptyGraph() {
  return { nodes: [{ id: START_NODE_ID, type: "start", x: 40, y: 140, data: {} }], edges: [] };
}

export function newId(prefix = "n") {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultNodeData(type) {
  switch (type) {
    case "message":
      return { mode: "text", text: "", footer: "", imageUrl: "", buttons: [], listButton: "Ver opções", items: [], linkLabel: "", linkUrl: "", followUp: { enabled: false, amount: 2, unit: "hours" } };
    case "input":
      return { text: "", variable: "resposta", followUp: { enabled: false, amount: 2, unit: "hours" } };
    case "action":
      return { actions: [{ type: "handoff" }] };
    case "condition":
      return { kind: "business_hours", start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] };
    case "delay":
      return { amount: 10, unit: "minutes" };
    default:
      return {};
  }
}

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Portas de saída de cada bloco
// ---------------------------------------------------------------------------

export function getOutputPorts(node) {
  const data = node?.data || {};
  switch (node?.type) {
    case "start":
      return [{ id: "next", label: "Então" }];
    case "message": {
      const ports = [];
      if (data.mode === "buttons") {
        for (const button of data.buttons || []) ports.push({ id: button.id, label: button.title || "Botão" });
        ports.push({ id: "other", label: "Outra resposta" });
      } else if (data.mode === "list") {
        for (const item of data.items || []) ports.push({ id: item.id, label: item.title || "Opção" });
        ports.push({ id: "other", label: "Outra resposta" });
      } else {
        ports.push({ id: "next", label: "Próximo passo" });
      }
      if ((data.mode === "buttons" || data.mode === "list") && data.followUp?.enabled) ports.push({ id: "no_reply", label: "Se não responder" });
      return ports;
    }
    case "input": {
      const ports = [{ id: "next", label: "Respondeu" }];
      if (data.followUp?.enabled) ports.push({ id: "no_reply", label: "Se não responder" });
      return ports;
    }
    case "condition":
      return [{ id: "yes", label: "Sim" }, { id: "no", label: "Não" }];
    default:
      return [{ id: "next", label: "Próximo passo" }];
  }
}

export function findEdge(graph, from, port) {
  return (graph?.edges || []).find((edge) => edge.from === from && edge.port === port) || null;
}

export function followUpMs(followUp) {
  const amount = Number(followUp?.amount) || 0;
  const unit = followUp?.unit === "hours" ? 60 : 1;
  return Math.max(1, amount) * unit * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Validação (usada pelo editor e por "Ativar")
// ---------------------------------------------------------------------------

export function validateTrigger(trigger) {
  const errors = [];
  if (!TRIGGER_TYPES.includes(trigger?.type)) errors.push("Escolha o gatilho do fluxo.");
  if (trigger?.type === "keyword") {
    const keywords = (trigger.keywords || []).map((word) => String(word || "").trim()).filter(Boolean);
    if (!keywords.length) errors.push("Informe ao menos uma palavra-chave para o gatilho.");
    if (keywords.length > LIMITS.maxKeywords) errors.push(`No máximo ${LIMITS.maxKeywords} palavras-chave.`);
  }
  return errors;
}

export function validateGraph(graph) {
  const errors = [];
  const warnings = [];
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const starts = nodes.filter((node) => node.type === "start");
  if (starts.length !== 1) errors.push({ nodeId: null, message: "O fluxo precisa ter exatamente um gatilho inicial." });
  if (byId.size !== nodes.length) errors.push({ nodeId: null, message: "Há blocos com identificador repetido." });

  for (const node of nodes) {
    if (!NODE_TYPES.includes(node.type)) errors.push({ nodeId: node.id, message: "Tipo de bloco desconhecido." });
    const data = node.data || {};

    if (node.type === "message") {
      const mode = data.mode;
      if (!MESSAGE_MODES.includes(mode)) errors.push({ nodeId: node.id, message: "Escolha o tipo da mensagem." });
      if (!String(data.text || "").trim()) errors.push({ nodeId: node.id, message: "A mensagem está sem texto." });
      if (String(data.text || "").length > LIMITS.bodyText) errors.push({ nodeId: node.id, message: `O texto passa de ${LIMITS.bodyText} caracteres.` });
      if (mode === "buttons") {
        const buttons = data.buttons || [];
        if (!buttons.length) errors.push({ nodeId: node.id, message: "Adicione ao menos um botão." });
        if (buttons.length > LIMITS.maxButtons) errors.push({ nodeId: node.id, message: `No máximo ${LIMITS.maxButtons} botões.` });
        for (const button of buttons) {
          if (!String(button.title || "").trim()) errors.push({ nodeId: node.id, message: "Há um botão sem texto." });
          if (String(button.title || "").length > LIMITS.buttonTitle) errors.push({ nodeId: node.id, message: `Texto do botão passa de ${LIMITS.buttonTitle} caracteres.` });
        }
        const titles = buttons.map((button) => normalizeText(button.title));
        if (new Set(titles).size !== titles.length) errors.push({ nodeId: node.id, message: "Há botões com o mesmo texto." });
      }
      if (mode === "list") {
        const items = data.items || [];
        if (!items.length) errors.push({ nodeId: node.id, message: "Adicione ao menos uma opção na lista." });
        if (items.length > LIMITS.maxListItems) errors.push({ nodeId: node.id, message: `No máximo ${LIMITS.maxListItems} opções na lista.` });
        if (!String(data.listButton || "").trim()) errors.push({ nodeId: node.id, message: "Informe o texto do botão que abre a lista." });
        if (String(data.listButton || "").length > LIMITS.listButton) errors.push({ nodeId: node.id, message: `Texto do botão da lista passa de ${LIMITS.listButton} caracteres.` });
        for (const item of items) {
          if (!String(item.title || "").trim()) errors.push({ nodeId: node.id, message: "Há uma opção da lista sem título." });
          if (String(item.title || "").length > LIMITS.listItemTitle) errors.push({ nodeId: node.id, message: `Título de opção passa de ${LIMITS.listItemTitle} caracteres.` });
          if (String(item.description || "").length > LIMITS.listItemDescription) errors.push({ nodeId: node.id, message: `Descrição de opção passa de ${LIMITS.listItemDescription} caracteres.` });
        }
      }
      if (mode === "link") {
        if (!String(data.linkLabel || "").trim()) errors.push({ nodeId: node.id, message: "Informe o texto do botão de link." });
        if (String(data.linkLabel || "").length > LIMITS.linkLabel) errors.push({ nodeId: node.id, message: `Texto do botão de link passa de ${LIMITS.linkLabel} caracteres.` });
        const url = String(data.linkUrl || "").trim();
        if (!url) errors.push({ nodeId: node.id, message: "Informe o endereço do link." });
        else if (!/^(https?:\/\/|\{\{link_simulacao\}\})/i.test(url)) errors.push({ nodeId: node.id, message: "O link precisa começar com https:// (ou ser {{link_simulacao}})." });
      }
      if (data.imageUrl && !/^https:\/\//i.test(String(data.imageUrl).trim())) errors.push({ nodeId: node.id, message: "A imagem precisa ser um link https://." });
    }

    if (node.type === "input") {
      if (!String(data.text || "").trim()) errors.push({ nodeId: node.id, message: "A pergunta está sem texto." });
      if (!/^[a-z][a-z0-9_]{0,30}$/i.test(String(data.variable || ""))) errors.push({ nodeId: node.id, message: "Nome da variável inválido (use letras, números e _)." });
    }

    if ((node.type === "message" || node.type === "input") && data.followUp?.enabled) {
      const ms = followUpMs(data.followUp);
      if (ms > LIMITS.maxDelayMinutes * 60 * 1000) errors.push({ nodeId: node.id, message: "O prazo de \"se não responder\" precisa ser menor que 23h (janela do WhatsApp)." });
    }

    if (node.type === "action") {
      const actions = data.actions || [];
      if (!actions.length) errors.push({ nodeId: node.id, message: "Escolha ao menos uma ação." });
      for (const action of actions) {
        if (!ACTION_TYPES.includes(action.type)) errors.push({ nodeId: node.id, message: "Ação desconhecida." });
        if (action.type === "tag" && !String(action.tag || "").trim()) errors.push({ nodeId: node.id, message: "Informe o nome da etiqueta." });
      }
    }

    if (node.type === "condition") {
      if (!CONDITION_KINDS.includes(data.kind)) errors.push({ nodeId: node.id, message: "Escolha a condição." });
      if (data.kind === "business_hours") {
        if (!/^\d{2}:\d{2}$/.test(String(data.start || "")) || !/^\d{2}:\d{2}$/.test(String(data.end || ""))) errors.push({ nodeId: node.id, message: "Horários inválidos." });
        if (!(data.days || []).length) errors.push({ nodeId: node.id, message: "Escolha ao menos um dia da semana." });
      }
    }

    if (node.type === "delay") {
      const minutes = (Number(data.amount) || 0) * (data.unit === "hours" ? 60 : 1);
      if (minutes < 1) errors.push({ nodeId: node.id, message: "Informe o tempo de espera." });
      if (minutes > LIMITS.maxDelayMinutes) errors.push({ nodeId: node.id, message: "A espera máxima é 23h (janela de 24h do WhatsApp)." });
    }
  }

  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) errors.push({ nodeId: null, message: "Há uma ligação apontando para um bloco que não existe." });
  }

  // Alcançáveis a partir do gatilho.
  const start = starts[0];
  if (start) {
    if (!findEdge(graph, start.id, "next")) errors.push({ nodeId: start.id, message: "Ligue o gatilho ao primeiro bloco." });
    const seen = new Set([start.id]);
    const queue = [start.id];
    while (queue.length) {
      const current = queue.shift();
      for (const edge of edges) {
        if (edge.from === current && !seen.has(edge.to)) {
          seen.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    for (const node of nodes) {
      if (!seen.has(node.id)) warnings.push({ nodeId: node.id, message: "Este bloco não está ligado ao fluxo e nunca será executado." });
    }
  }

  // Portas sem ligação = a conversa termina ali (aviso, não erro).
  for (const node of nodes) {
    if (node.type === "start") continue;
    for (const port of getOutputPorts(node)) {
      if (port.id === "other" || port.id === "no_reply") continue;
      if (!findEdge(graph, node.id, port.id)) warnings.push({ nodeId: node.id, message: `"${port.label}" não leva a nenhum bloco (o fluxo termina aí).` });
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Gatilhos
// ---------------------------------------------------------------------------

export function matchTrigger(trigger, { text = "", isFirstMessage = false, hasReferral = false } = {}) {
  switch (trigger?.type) {
    case "keyword": {
      const message = normalizeText(text);
      if (!message) return false;
      return (trigger.keywords || []).some((word) => {
        const keyword = normalizeText(word);
        if (!keyword) return false;
        return trigger.match === "exact" ? message === keyword : message.includes(keyword);
      });
    }
    case "first_message":
      return Boolean(isFirstMessage);
    case "ad_referral":
      return Boolean(hasReferral);
    case "any_message":
      return true;
    default:
      return false;
  }
}

// Quanto menor, mais específico (vence quando vários fluxos casam).
export const TRIGGER_PRIORITY = { keyword: 0, ad_referral: 1, first_message: 2, any_message: 3 };

export function defaultCooldownHours(triggerType) {
  return { keyword: 0, ad_referral: 0, first_message: 24, any_message: 12 }[triggerType] ?? 0;
}

// ---------------------------------------------------------------------------
// Variáveis e texto
// ---------------------------------------------------------------------------

export function interpolate(text, vars = {}) {
  return String(text || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function firstName(fullName) {
  return String(fullName || "").trim().split(/\s+/)[0] || "";
}

function cut(value, max) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

// Id de botão/linha na Meta: "fl:<fluxo>:<bloco>:<porta>" — identifica de qual
// fluxo/bloco veio o toque mesmo que o cliente toque num botão antigo.
export function encodeReplyId(flowId, nodeId, portId) {
  return `fl:${flowId}:${nodeId}:${portId}`;
}

export function decodeReplyId(value) {
  const match = /^fl:([^:]+):([^:]+):(.+)$/.exec(String(value || ""));
  return match ? { flowId: match[1], nodeId: match[2], portId: match[3] } : null;
}

// Monta a mensagem no formato da Cloud API + uma versão "de exibição" para o
// Chat e a Pré-visualização.
export function buildOutgoing(node, vars, flowId = "preview") {
  const data = node.data || {};
  const text = cut(interpolate(data.text, vars), LIMITS.bodyText);
  const footer = data.footer ? cut(interpolate(data.footer, vars), LIMITS.footer) : "";
  const image = data.imageUrl ? { type: "image", image: { link: String(data.imageUrl).trim() } } : null;

  if (node.type === "input") {
    return { message: { type: "text", text: { body: text } }, display: { text, buttons: [], mode: "text" } };
  }

  switch (data.mode) {
    case "buttons": {
      const buttons = (data.buttons || []).slice(0, LIMITS.maxButtons);
      const interactive = {
        type: "button",
        body: { text },
        action: { buttons: buttons.map((button) => ({ type: "reply", reply: { id: encodeReplyId(flowId, node.id, button.id), title: cut(button.title, LIMITS.buttonTitle) } })) }
      };
      if (image) interactive.header = image;
      if (footer) interactive.footer = { text: footer };
      return { message: { type: "interactive", interactive }, display: { text, footer, imageUrl: data.imageUrl || "", buttons: buttons.map((button) => cut(button.title, LIMITS.buttonTitle)), mode: "buttons" } };
    }
    case "list": {
      const items = (data.items || []).slice(0, LIMITS.maxListItems);
      const interactive = {
        type: "list",
        body: { text },
        action: {
          button: cut(data.listButton || "Ver opções", LIMITS.listButton),
          sections: [{
            title: "Opções",
            rows: items.map((item) => {
              const row = { id: encodeReplyId(flowId, node.id, item.id), title: cut(item.title, LIMITS.listItemTitle) };
              if (item.description) row.description = cut(item.description, LIMITS.listItemDescription);
              return row;
            })
          }]
        }
      };
      if (footer) interactive.footer = { text: footer };
      return { message: { type: "interactive", interactive }, display: { text, footer, buttons: [], list: { button: interactive.action.button, items: items.map((item) => item.title) }, mode: "list" } };
    }
    case "link": {
      const url = interpolate(data.linkUrl, vars).trim();
      const interactive = {
        type: "cta_url",
        body: { text },
        action: { name: "cta_url", parameters: { display_text: cut(data.linkLabel, LIMITS.linkLabel), url } }
      };
      if (image) interactive.header = image;
      if (footer) interactive.footer = { text: footer };
      return { message: { type: "interactive", interactive }, display: { text, footer, imageUrl: data.imageUrl || "", buttons: [], link: { label: interactive.action.parameters.display_text, url }, mode: "link" } };
    }
    default:
      return { message: { type: "text", text: { body: text } }, display: { text, buttons: [], mode: "text" } };
  }
}

// ---------------------------------------------------------------------------
// Horário comercial (America/Sao_Paulo)
// ---------------------------------------------------------------------------

export function isWithinBusinessHours(config, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get("weekday")];
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const toMinutes = (value) => {
    const [h, m] = String(value || "0:0").split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  if (!(config?.days || []).includes(weekday)) return false;
  const start = toMinutes(config.start);
  const end = toMinutes(config.end);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

function cloneSession(session) {
  return {
    currentNodeId: session.currentNodeId ?? null,
    pendingTarget: session.pendingTarget ?? null,
    awaiting: session.awaiting ? { ...session.awaiting } : null,
    vars: { ...(session.vars || {}) },
    retries: session.retries || 0
  };
}

// Escolhe a porta de saída a partir da resposta do cliente ao bloco de
// escolha (botões/lista): id do toque > texto igual ao rótulo > "other".
export function resolveChoicePort(node, reply, flowId) {
  const data = node.data || {};
  const options = data.mode === "list" ? data.items || [] : data.mode === "buttons" ? data.buttons || [] : [];
  const decoded = decodeReplyId(reply?.replyId);
  if (decoded && decoded.flowId === flowId && decoded.nodeId === node.id && options.some((option) => option.id === decoded.portId)) {
    return decoded.portId;
  }
  const typed = normalizeText(reply?.text);
  if (typed) {
    const match = options.find((option) => normalizeText(option.title) === typed);
    if (match) return match.id;
  }
  return null;
}

/**
 * Executa o fluxo a partir do estado da sessão.
 *
 * session: { currentNodeId, pendingTarget, awaiting, vars, retries }
 * input:
 *   null                              — início (currentNodeId = "start")
 *   { kind: "reply", text, replyId }  — cliente respondeu
 *   { kind: "timeout" }               — passou o prazo de "se não responder"
 *   { kind: "resume" }                — acabou uma "Espera"
 * deps: { send(outgoing, node) -> Promise, runActions(actions) -> Promise<{vars?, handoff?, stop?}>,
 *         evaluateCondition(data) -> Promise<boolean>, canSend() -> boolean, log(kind, nodeId, detail), now() }
 *
 * Devolve { session, status: "waiting"|"completed"|"handoff"|"failed"|"expired", waitUntil, endReason }.
 */
export async function runFlow({ graph, flowId, session: initial, input = null, deps }) {
  const session = cloneSession(initial);
  const nodes = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const nowMs = () => (deps.now ? deps.now() : Date.now());
  let sends = 0;
  let steps = 0;
  let pointer = null;

  const done = (status, endReason = null) => {
    session.currentNodeId = null;
    session.awaiting = null;
    session.pendingTarget = null;
    return { session, status, waitUntil: null, endReason };
  };
  const wait = (waitUntilMs) => ({ session, status: "waiting", waitUntil: waitUntilMs ? new Date(waitUntilMs) : null, endReason: null });
  const target = (nodeId, port) => findEdge(graph, nodeId, port)?.to || null;

  // 1) Interpreta a entrada e decide o ponteiro inicial.
  if (!input) {
    pointer = session.currentNodeId || START_NODE_ID;
  } else if (input.kind === "resume") {
    pointer = session.pendingTarget;
    session.pendingTarget = null;
    if (!pointer) return done("completed", "sem_proximo_bloco");
  } else if (input.kind === "timeout") {
    const node = session.awaiting ? nodes.get(session.awaiting.nodeId) : null;
    session.awaiting = null;
    pointer = node ? target(node.id, "no_reply") : null;
    deps.log?.("timeout", node?.id || null, {});
    if (!pointer) return done("completed", "sem_resposta");
  } else if (input.kind === "reply") {
    const awaiting = session.awaiting;
    if (!awaiting) return { session, status: "waiting", waitUntil: null, endReason: null, ignored: true };
    const node = nodes.get(awaiting.nodeId);
    if (!node) return done("failed", "bloco_inexistente");

    if (awaiting.type === "text") {
      const text = String(input.text || "").trim();
      if (!text) return { session, status: "waiting", waitUntil: awaiting.waitUntil ? new Date(awaiting.waitUntil) : null, endReason: null, ignored: true };
      session.vars[node.data.variable] = text.slice(0, 500);
      if (node.data.variable === "nome") session.vars.primeiro_nome = firstName(text);
      deps.log?.("reply", node.id, { text: text.slice(0, 200), variable: node.data.variable });
      session.awaiting = null;
      pointer = target(node.id, "next");
      if (!pointer) return done("completed", "fim_do_fluxo");
    } else {
      const port = resolveChoicePort(node, input, flowId);
      deps.log?.("reply", node.id, { text: String(input.text || "").slice(0, 200), port });
      if (port) {
        session.awaiting = null;
        session.retries = 0;
        pointer = target(node.id, port);
        if (!pointer) return done("completed", "fim_do_fluxo");
      } else {
        const other = target(node.id, "other");
        if (other) {
          session.awaiting = null;
          session.retries = 0;
          pointer = other;
        } else if (session.retries < LIMITS.maxRetries) {
          // Resposta que não é nenhuma das opções: repete a pergunta (até 2x)
          // e, se o cliente insistir, passa para uma pessoa.
          session.retries += 1;
          session.awaiting = null;
          pointer = node.id;
        } else {
          deps.log?.("handoff", node.id, { reason: "resposta_fora_das_opcoes" });
          if (deps.onHandoff) await deps.onHandoff("resposta_fora_das_opcoes");
          return done("handoff", "resposta_fora_das_opcoes");
        }
      }
    }
  }

  // 2) Percorre os blocos até esperar algo do cliente ou terminar.
  while (pointer) {
    steps += 1;
    if (steps > LIMITS.maxSteps) return done("failed", "limite_de_passos");
    const node = nodes.get(pointer);
    if (!node) return done("failed", "bloco_inexistente");
    session.currentNodeId = node.id;

    if (node.type === "start") {
      pointer = target(node.id, "next");
      continue;
    }

    if (node.type === "message" || node.type === "input") {
      if (sends >= LIMITS.maxSendsPerRun) {
        // Muitas mensagens numa rodada só: continua no próximo ciclo do cron.
        session.pendingTarget = node.id;
        session.awaiting = null;
        return wait(nowMs());
      }
      if (!deps.canSend()) {
        deps.log?.("end", node.id, { reason: "janela_de_24h_fechada" });
        return done("expired", "janela_de_24h_fechada");
      }
      const outgoing = buildOutgoing(node, session.vars, flowId);
      await deps.send(outgoing, node);
      sends += 1;
      deps.log?.("send", node.id, { mode: node.data.mode || "input", preview: outgoing.display.text.slice(0, 200) });

      if (node.type === "input") {
        const waitUntilMs = node.data.followUp?.enabled ? nowMs() + followUpMs(node.data.followUp) : null;
        session.awaiting = { nodeId: node.id, type: "text", waitUntil: waitUntilMs ? new Date(waitUntilMs).toISOString() : null };
        return wait(waitUntilMs);
      }
      if (node.data.mode === "buttons" || node.data.mode === "list") {
        const waitUntilMs = node.data.followUp?.enabled ? nowMs() + followUpMs(node.data.followUp) : null;
        session.awaiting = { nodeId: node.id, type: "choice", waitUntil: waitUntilMs ? new Date(waitUntilMs).toISOString() : null };
        return wait(waitUntilMs);
      }
      pointer = target(node.id, "next");
      continue;
    }

    if (node.type === "action") {
      const result = (await deps.runActions(node.data.actions || [], session.vars)) || {};
      if (result.vars) Object.assign(session.vars, result.vars);
      deps.log?.("action", node.id, { actions: (node.data.actions || []).map((action) => action.type), ...(result.detail || {}) });
      if (result.handoff) return done("handoff", "passou_para_atendente");
      if (result.stop) return done("completed", "encerrado_por_acao");
      pointer = target(node.id, "next");
      continue;
    }

    if (node.type === "condition") {
      const ok = Boolean(await deps.evaluateCondition(node.data));
      deps.log?.("condition", node.id, { kind: node.data.kind, result: ok });
      pointer = target(node.id, ok ? "yes" : "no");
      continue;
    }

    if (node.type === "delay") {
      const next = target(node.id, "next");
      if (!next) return done("completed", "fim_do_fluxo");
      const minutes = (Number(node.data.amount) || 0) * (node.data.unit === "hours" ? 60 : 1);
      session.pendingTarget = next;
      session.awaiting = null;
      deps.log?.("delay", node.id, { minutes });
      return wait(nowMs() + Math.max(1, minutes) * 60 * 1000);
    }

    return done("failed", "tipo_de_bloco_desconhecido");
  }

  return done("completed", "fim_do_fluxo");
}
