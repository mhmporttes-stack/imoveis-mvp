import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAssistantText,
  firstNameOf,
  formatDurationSeconds,
  formatWaitMinutes,
  funnelBars,
  leadOriginBreakdown,
  leadOriginHint,
  medianOf,
  responseGapsSeconds,
  summarizeResponseTimes
} from "../lib/painel-inicio-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const at = (minutes) => new Date(Date.UTC(2026, 9, 22, 12, 0, 0) + minutes * 60000).toISOString();
const inbound = (conversation, minutes, extra = {}) => ({ conversation_id: conversation, direction: "inbound", message_at: at(minutes), ...extra });
const human = (conversation, minutes, extra = {}) => ({ conversation_id: conversation, direction: "outbound", sender_type: "user", status: "delivered", message_type: "text", message_at: at(minutes), ...extra });

test("MET-6: mensagem do cliente -> primeira resposta HUMANA seguinte, a partir da primeira mensagem que espera", () => {
  const messages = [
    inbound("a", 0), inbound("a", 2), // espera conta da 1ª
    { ...human("a", 3), sender_type: "automation" }, // automação não conta
    human("a", 5, { status: "failed" }), // falhou: sem evidência de envio
    human("a", 6), // primeira resposta humana: 6 min
    human("a", 7), // sem cliente esperando: ignora
    inbound("b", 10), human("b", 10.5)
  ];
  assert.deepEqual(responseGapsSeconds(messages).sort((x, y) => x - y), [30, 360]);
});

test("MET-6: nota interna, reação, histórico importado e eco da automação nunca contam como resposta", () => {
  const messages = [
    inbound("a", 0),
    human("a", 1, { message_type: "reaction" }),
    human("a", 2, { metadata: { history: true } }),
    human("a", 3, { metadata: { automation_echo: true } }),
    { conversation_id: "a", direction: "internal", sender_type: "user", status: "sent", message_at: at(4) },
    inbound("b", 0, { message_type: "reaction" }), human("b", 1) // reação do cliente não abre espera
  ];
  assert.deepEqual(responseGapsSeconds(messages), []);
});

test("mediana e n (nunca média)", () => {
  assert.equal(medianOf([]), null);
  assert.equal(medianOf([10, 1000, 20]), 20);
  assert.equal(medianOf([10, 20, 30, 1000]), 25);
  const summary = summarizeResponseTimes([inbound("a", 0), human("a", 4), inbound("b", 0), human("b", 60)]);
  assert.deepEqual(summary, { medianSeconds: 1920, count: 2 });
  assert.deepEqual(summarizeResponseTimes([]), { medianSeconds: null, count: 0 });
});

test("formatação de tempo", () => {
  assert.equal(formatDurationSeconds(45), "45 s");
  assert.equal(formatDurationSeconds(250), "4 min 10 s");
  assert.equal(formatDurationSeconds(300), "5 min");
  assert.equal(formatDurationSeconds(3900), "1 h 05 min");
  assert.equal(formatDurationSeconds(null), "—");
  assert.equal(formatWaitMinutes(12), "12 min");
  assert.equal(formatWaitMinutes(125), "2 h 05 min");
  assert.equal(formatWaitMinutes(3 * 24 * 60), "3 dias");
});

test("origem dos leads: anúncio pela evidência de mídia paga, Marketplace pela origem, o resto junto", () => {
  const breakdown = leadOriginBreakdown([
    { acquisition_context: { kind: "whatsapp_ad" } },
    { acquisition_context: { kind: "paid_link" } },
    { acquisition_context: { kind: "site", metadata: { utm_medium: "cpc" } } },
    { acquisition_context: { kind: "facebook_marketplace" } },
    { acquisition_context: { kind: "broker_link" } },
    { acquisition_context: null }
  ]);
  assert.deepEqual(breakdown, { total: 6, ad: 3, marketplace: 1, other: 2 });
  assert.equal(leadOriginHint(breakdown), "3 anúncio · 1 Marketplace · 2 outras origens");
  assert.equal(leadOriginHint({ total: 0 }), "nenhum cadastro novo hoje");
});

test("frase do assistente só com os números recebidos (sem IA, sem inventar)", () => {
  assert.equal(
    buildAssistantText({ greeting: "Bom dia", firstName: "Matheus", awaitingReply: 4, toReview: 2, overdue: 1, urgent: { name: "Débora Lima", waitingMinutes: 38 } }),
    "Bom dia, Matheus. Hoje você tem 4 clientes aguardando resposta, 2 simulações a conferir e 1 atividade atrasada. Comece por Débora Lima, que espera resposta há 38 min."
  );
  // Chat indisponível (null) fica fora da frase; o cliente urgente só aparece quando há alguém aguardando resposta.
  assert.equal(
    buildAssistantText({ greeting: "Boa tarde", firstName: "Bruna", awaitingReply: null, toReview: 1, overdue: 0, urgent: { name: "X", waitingMinutes: 5 } }),
    "Boa tarde, Bruna. Hoje você tem 1 simulação a conferir."
  );
  assert.match(buildAssistantText({ greeting: "Boa noite", firstName: "Carol", awaitingReply: 0, toReview: 0, overdue: 0 }), /^Boa noite, Carol\. Nada urgente agora/);
  assert.equal(firstNameOf("  Jennyfer Zorzato "), "Jennyfer");
});

test("funil do mês: sem a base Prospecção, proporção pela maior etapa", () => {
  const bars = funnelBars([
    { key: "clients", label: "Prospecção", value: 500 },
    { key: "service", label: "Atendimento", value: 200 },
    { key: "sale", label: "Venda", value: 50 }
  ]);
  assert.deepEqual(bars.map((bar) => [bar.key, bar.value, bar.width]), [["service", 200, 100], ["sale", 50, 25]]);
});

test("Início: primeiro item do menu de todos os perfis, ícone de casa, página com guard e sem mudar a entrada do painel", () => {
  const menu = read("components/AdminMenu.jsx");
  assert.match(menu, /const HOME_ITEM = \{ href: "\/admin\/inicio", label: "Início", key: "inicio" \}/);
  assert.match(menu, /index === 0 \? \{ \.\.\.group, items: \[HOME_ITEM, \.\.\.group\.items\] \}/);
  assert.match(menu, /\["\/admin\/inicio", "inicio"\]/);
  assert.match(read("components/admin-nav-icons.js"), /inicio: House/);
  const page = read("app/admin/inicio/page.jsx");
  assert.match(page, /const auth = await requireAdminPage\(\);/);
  assert.doesNotMatch(read("app/admin/page.jsx"), /\/admin\/inicio/);
});

test("Início reaproveita as fontes existentes (nenhuma definição nova)", () => {
  const lib = read("lib/painel-inicio.js");
  assert.match(lib, /getCrmPendingCounts\(auth\)/);
  assert.match(lib, /getChatSummary\(auth, \{ includeOldestAwaiting: true, byBroker: isGeneralAdminAuth\(auth\) \}\)/);
  assert.match(lib, /getChatResponseTimes\(auth/);
  assert.match(lib, /getPerformanceOverview\(\{ period: OVERVIEW_PERIODS\.THIS_MONTH/);
  assert.match(lib, /CLIENT_STATUS\.AUTO_SIMULATION/);
  assert.match(lib, /applyResponsibleUserScope/);
  // O balão do cabeçalho e o Início leem a mesma função e a mesma lista.
  assert.match(read("app/api/admin/crm-badge-counts/route.js"), /getCrmPendingCounts\(auth\)/);
  assert.match(read("components/AdminMenu.jsx"), /crmPendingItems\(counts, \{ hideChat \}\)/);
});
