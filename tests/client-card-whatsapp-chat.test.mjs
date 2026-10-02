import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Regra do dono (2026-10-02): o botão "WhatsApp" do card de cliente abre a conversa
// do cliente DENTRO do Chat do CRM — sem WhatsApp Web/app externo, sem conversa
// duplicada e sem mudar atendente/responsável. Teste estrutural dos pontos que
// garantem isso.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFileSync(path.join(root, file), "utf8");

function functionBody(code, signature) {
  const start = code.indexOf(signature);
  assert.ok(start >= 0, `não achei ${signature}`);
  const next = code.indexOf("\n  async function ", start + signature.length);
  return code.slice(start, next > 0 ? next : undefined);
}

test("botão WhatsApp do card navega para o Chat focado no cliente (sem WhatsApp externo)", () => {
  const hook = source("components/clients/useClientList.js");
  const body = functionBody(hook, "function openWhatsApp(client)");
  assert.match(body, /router\.push\(`\/admin\/chat\?client=\$\{encodeURIComponent\(registrationId\)\}`\)/);
  assert.match(body, /const registrationId = client\.registration\.id;/);
  // 2026-10-02 (T-24): fora só quando o ESTADO real manda; o hook nunca monta URL externa por conta própria.
  assert.match(body, /decideCardWhatsapp\(/);
  assert.match(body, /window\.open\(decision\.url/);
  assert.doesNotMatch(body, /window\.location|buildWhatsAppUrl|wa\.me|api\.whatsapp\.com|web\.whatsapp/);
  assert.match(body, /toWhatsAppDigits\(value\)/, "telefone inválido continua barrado antes de sair da lista");
});

// 1º clique "parado" (2026-10-02): a navegação esperava o registro do contato (~2 s) sem nenhum aviso
// na tela, então o clique parecia não ter feito nada. Registro em paralelo + transição com card ocupado.
test("clique no botão WhatsApp responde na hora: sem espera antes de navegar e com card ocupado", () => {
  const hook = source("components/clients/useClientList.js");
  const body = functionBody(hook, "function openWhatsApp(client)");
  assert.doesNotMatch(body, /\bawait\b/, "nenhuma espera antes de navegar");
  assert.match(body, /whatsapp-contact`, \{ method: "POST", keepalive: true \}/);
  assert.match(body, /startChatNavigation\(\(\) => \{\s*router\.push/);
  assert.match(hook, /busyClientId: busyClientId \|\| \(chatNavPending \? openingChatClientId : ""\)/);
  assert.match(source("components/clients/ClientCard.jsx"), /onClick=\{\(\) => list\.openWhatsApp\(client\)\} disabled=\{busy\}/, "botão desabilitado enquanto abre (sem clique repetido)");
});

test("o Chat recebe ?client= e abre a conversa (mobile e desktop usam a mesma página)", () => {
  assert.match(source("app/admin/chat/page.jsx"), /initialClientId=\{typeof params\.client === "string" \? params\.client : ""\}/);
  assert.match(source("components/WhatsappChat.jsx"), /\/api\/admin\/whatsapp-chat\/open-client/);
});

test("abrir pelo card nunca muda atendente/status e nunca duplica conversa", () => {
  assert.match(source("app/api/admin/whatsapp-chat/open-client/route.js"), /openChatForClient\(String\(body\.clientId\), auth, \{ assign: false \}\)/);
  const code = source("lib/whatsapp-chat.js");
  const start = code.indexOf("export async function openChatForClient(");
  const body = code.slice(start, code.indexOf("export async function getClientChatWindow("));
  assert.match(body, /\{ assign = true \} = \{\}/);
  assert.match(body, /if \(assign && isResponsible && !conversation\.assigned_user_id\)/);
  assert.ok(body.indexOf('.eq("client_id", client.id)') < body.indexOf("phoneLookupCandidates(phone)"), "procura a conversa vinculada ao cliente antes da do telefone");
  assert.match(body, /createError\.code !== "23505"/, "corrida na criação reaproveita a conversa existente");
  assert.match(body, /!scope\.all && !scope\.brokerIds\.includes\(client\.responsible_user_id\)/, "escopo/hierarquia do Chat mantido");
  // Conversa = telefone + sessão (2026-10-02): o card abre a conversa do WhatsApp do RESPONSÁVEL, nunca a de outro número.
  assert.match(body, /\.eq\("session_key", sessionKey\)/, "busca sempre dentro da sessão do responsável");
});

// Falha ao registrar o contato (2026-10-02): nunca bloqueia a abertura do Chat; deixa um aviso
// discreto lá ("aberto, mas o contato não pôde ser salvo/sincronizado").
test("falha no registro do contato avisa no Chat sem bloquear a navegação", async () => {
  const hook = source("components/clients/useClientList.js");
  const body = functionBody(hook, "function openWhatsApp(client)");
  assert.match(body, /\.then\(\(response\) => \{ if \(!response\.ok\) throw new Error/);
  assert.match(body, /\.catch\(\(\) => flagContactNotSaved\(/);
  assert.ok(body.indexOf("flagContactNotSaved(") < body.indexOf("startChatNavigation("), "o registro é disparado sem esperar (não há await entre eles)");
  assert.doesNotMatch(body, /\bawait\b/);
  const chat = source("components/WhatsappChat.jsx");
  assert.match(chat, /takeContactNotSavedWarning\(\)/);
  assert.match(chat, /addEventListener\(CONTACT_WARNING_EVENT, check\)/);
  assert.match(chat, /\{contactWarning \? \(/);
  const { contactWarningMessage } = await import("../lib/whatsapp-contact-warning.mjs");
  assert.match(contactWarningMessage("Lu"), /O Chat foi aberto, mas o contato de Lu não pôde ser salvo\/sincronizado/);
  assert.match(contactWarningMessage(""), /O Chat foi aberto, mas o contato não pôde ser salvo\/sincronizado/);
});

// Celular/PWA (2026-10-02): o botão "WhatsApp" abriu o app EXTERNO no celular porque o app instalado
// ficava aberto por dias rodando JavaScript antigo (de antes da regra "abre o Chat do CRM"). O código
// atual não tem nenhum caminho externo, nem por ramo mobile/PWA; e o app passa a procurar versão nova.
test("card e ficha (mobile/desktop) só têm o caminho do Chat — nenhum deep link, wa.me ou ramo por dispositivo", () => {
  const card = source("components/clients/ClientCard.jsx");
  const sheet = source("components/clients/ClientSheet.jsx");
  for (const [name, code] of [["ClientCard", card], ["ClientSheet", sheet]]) {
    assert.match(code, /list\.openWhatsApp\(client\)/, `${name}: botão WhatsApp usa list.openWhatsApp`);
    assert.doesNotMatch(code, /wa\.me|whatsapp:\/\/|api\.whatsapp\.com|web\.whatsapp|intent:\/\//, `${name}: sem link externo do WhatsApp`);
  }
  const hook = source("components/clients/useClientList.js");
  const body = functionBody(hook, "function openWhatsApp(client)");
  assert.doesNotMatch(body, /isMobile|standalone|display-mode|userAgent|matchMedia|navigator\./, "sem ramo por celular/PWA/user-agent");
  assert.doesNotMatch(body, /location\.(assign|href|replace)|<a /, "sem navegar para URL externa; janela externa só via decisão pelo estado (decision.url)");
});

test("app instalado procura versão nova ao voltar e a cada 10 min, sem recarregar no meio da digitação", () => {
  const pwa = source("components/PwaLifecycle.jsx");
  assert.match(pwa, /document\.addEventListener\("visibilitychange", checkForNewVersion\)/);
  assert.match(pwa, /UPDATE_CHECK_INTERVAL_MS = 10 \* 60 \* 1000/);
  assert.match(pwa, /updateRegistration\?\.update\(\)/);
  assert.match(pwa, /if \(!userIsTyping\(\)\) \{\s*window\.location\.reload\(\);/);
});
