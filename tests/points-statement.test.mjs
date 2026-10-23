import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPointsStatement, describeLedgerRow, firstNameOrClient, normalizeStatementPeriod, POINTS_STATEMENT_LIMIT } from "../lib/points-statement-core.mjs";
import { isBrokerInScope, resolveTeamMetaScope } from "../lib/team-meta-scope-core.mjs";

const row = (over) => ({ brokerId: "b1", brokerName: "Gabriel Ribeiro", clientName: "—", action: "Prospecção — 1ª tentativa", points: 1, occurredAt: "2026-10-22T15:00:00.000Z", origin: "Meta Diária", ...over });

test("soma das linhas = total (o que tem que bater com o selo), inclusive com ajuste manual e desconto", () => {
  const rows = [
    row({ points: 1, occurredAt: "2026-10-22T14:00:00.000Z" }),
    row({ action: "Cliente aprovado", origin: "Mudança de status", clientName: "Maria Souza Lima", points: 30, occurredAt: "2026-10-22T16:00:00.000Z" }),
    row({ action: "Ajuste manual — premiação", origin: "Ajuste manual", note: "premiação", points: 50, occurredAt: "2026-10-22T21:06:00.000Z" }),
    row({ action: "Meta Diária não concluída", points: -10, occurredAt: "2026-10-22T02:59:59.000Z" }),
    row({ brokerId: "outro", points: 999 })
  ];
  const statement = buildPointsStatement(rows, { brokerId: "b1" });
  assert.equal(statement.total, 71);
  assert.equal(statement.lines.reduce((sum, line) => sum + line.points, 0), statement.total);
  assert.equal(statement.count, 4);
  assert.equal(statement.truncated, false);
  // mais recente primeiro
  assert.deepEqual(statement.lines.map((line) => line.points), [50, 30, 1, -10]);
});

test("ajuste manual: 'Ajuste do dono' + nota, hora em America/Sao_Paulo (18:06)", () => {
  const statement = buildPointsStatement([row({ action: "Ajuste manual — premiação", origin: "Ajuste manual", note: "premiação", points: 50, occurredAt: "2026-10-22T21:06:00.000Z" })], { brokerId: "b1", todayYmd: "2026-10-22" });
  const line = statement.lines[0];
  assert.equal(line.kind, "manual_adjustment");
  assert.equal(line.label, "Ajuste do dono");
  assert.equal(line.note, "premiação");
  assert.equal(line.time, "18:06");
  assert.equal(line.person, "");
  assert.equal(statement.days[0].label, "Hoje");
});

test("ajuste manual sem nota e com nota gigante não quebra nem vaza texto longo", () => {
  assert.equal(describeLedgerRow({ origin: "Ajuste manual", action: "Ajuste manual — sem motivo informado", note: "" }).note, "sem motivo informado");
  assert.equal(describeLedgerRow({ origin: "Ajuste manual", note: "x".repeat(500) }).note.length, 200);
});

test("cliente aparece só pelo primeiro nome; sem nome ou com número vira 'cliente'", () => {
  assert.equal(firstNameOrClient("Maria Souza Lima"), "Maria");
  assert.equal(firstNameOrClient("  "), "cliente");
  assert.equal(firstNameOrClient("—"), "cliente");
  assert.equal(firstNameOrClient("11999998888"), "cliente");
  assert.equal(firstNameOrClient("Cliente"), "cliente");
  const statement = buildPointsStatement([row({ action: "Cliente aprovado", origin: "Mudança de status", clientName: "Maria Souza Lima", points: 30 })], { brokerId: "b1" });
  assert.equal(statement.lines[0].person, "Maria");
  assert.ok(!JSON.stringify(statement).includes("Souza"));
});

test("motivos em português claro para cada origem de pontos", () => {
  const cases = [
    [{ action: "Novo cliente cadastrado", origin: "Cadastro" }, "new_client", "Novo cliente cadastrado"],
    [{ action: "Prospecção — 2ª tentativa", origin: "Meta Diária" }, "prospecting_attempt", "2ª tentativa de contato (Meta Diária)"],
    [{ action: "Prospecção — contato assumido", origin: "Prospecção manual" }, "prospecting_claim", "Contato assumido na prospecção"],
    [{ action: "Prospecção — link pessoal", origin: "Link pessoal do corretor" }, "prospecting_link", "Cliente entrou pelo link pessoal"],
    [{ action: "Cliente em atendimento", origin: "Mudança de status" }, "milestone", "Cliente passou para atendimento"],
    [{ action: "Simulação realizada", origin: "Mudança de status" }, "milestone", "Simulação realizada"],
    [{ action: "Cliente enviado para aprovação", origin: "Mudança de status" }, "milestone", "Enviado para aprovação"],
    [{ action: "Bônus de Meta Diária batida (120% da meta)", origin: "Meta Diária" }, "goal_bonus", "Bônus por bater a Meta Diária (120%)"],
    [{ action: "Meta Diária não concluída", origin: "Meta Diária" }, "goal_penalty", "Meta Diária não concluída (desconto)"],
    [{ action: "Tempo online — 95 min (9 intervalos)", origin: "Presença no CRM" }, "presence", "Tempo online (95 min)"],
    [{ action: "Mais tempo online — 300 min", origin: "Presença no CRM" }, "presence_top", "Mais tempo online do dia"]
  ];
  for (const [input, kind, label] of cases) {
    const described = describeLedgerRow(input);
    assert.equal(described.kind, kind, input.action);
    assert.equal(described.label, label, input.action);
  }
  const capped = describeLedgerRow({ action: "Prospecção — 1ª tentativa (teto do dia atingido)", origin: "Meta Diária" });
  assert.equal(capped.label, "1ª tentativa de contato (Meta Diária)");
  assert.match(capped.note, /teto/i);
  assert.equal(describeLedgerRow({ action: "Algo novo", origin: "X" }).label, "Algo novo");
});

test("limite de 200 linhas: lista corta, mas o total continua somando tudo", () => {
  const rows = Array.from({ length: 250 }, (_, index) => row({ points: 1, occurredAt: new Date(Date.UTC(2026, 9, 22, 12, 0, 0) + index * 1000).toISOString() }));
  const statement = buildPointsStatement(rows, { brokerId: "b1" });
  assert.equal(POINTS_STATEMENT_LIMIT, 200);
  assert.equal(statement.lines.length, 200);
  assert.equal(statement.total, 250);
  assert.equal(statement.truncated, true);
  assert.equal(statement.hiddenCount, 50);
  assert.equal(statement.hiddenPoints, 50);
  assert.equal(statement.lines[0].occurredAt, rows[249].occurredAt);
});

test("agrupa por dia de São Paulo (23h local não cai no dia seguinte UTC) com subtotal do dia", () => {
  const statement = buildPointsStatement([
    row({ points: 5, occurredAt: "2026-10-22T02:30:00.000Z" }), // 21/10 23:30 em SP
    row({ points: 3, occurredAt: "2026-10-22T15:00:00.000Z" }),
    row({ points: 2, occurredAt: "2026-10-22T16:00:00.000Z" })
  ], { brokerId: "b1", todayYmd: "2026-10-22" });
  assert.deepEqual(statement.days.map((day) => [day.day, day.label, day.total]), [["2026-10-22", "Hoje", 5], ["2026-10-21", "Ontem", 5]]);
});

test("período aceita só os 4 do seletor; qualquer outro vira Hoje", () => {
  for (const value of ["today", "yesterday", "last7", "last30"]) assert.equal(normalizeStatementPeriod(value), value);
  assert.equal(normalizeStatementPeriod("custom"), "today");
  assert.equal(normalizeStatementPeriod(undefined), "today");
});

test("escopo: dono vê todos; gestora só equipe (sem ela mesma); corretor/associado negado", () => {
  const owner = resolveTeamMetaScope({ isOwner: true });
  assert.equal(isBrokerInScope(owner, "qualquer"), true);
  const manager = resolveTeamMetaScope({ isManager: true, profileId: "g1", managedUserIds: ["g1", "b1", "a1"] });
  assert.equal(isBrokerInScope(manager, "b1"), true);
  assert.equal(isBrokerInScope(manager, "b9"), false);
  assert.equal(isBrokerInScope(manager, "g1"), false);
  const broker = resolveTeamMetaScope({ profileId: "b1" });
  assert.equal(broker.mode, "denied");
  assert.equal(isBrokerInScope(broker, "b1"), false);
});

test("rota: guard de admin/gestor e checagem de equipe no backend; extrato usa o ledger do Ranking sem brokerId", () => {
  const route = readFileSync(new URL("../app/api/daily-goal/team-overview/[brokerId]/points-statement/route.js", import.meta.url), "utf8");
  assert.match(route, /requireBrokerManagementApi\(request\)/);
  assert.ok(route.indexOf("requireBrokerManagementApi(request)") < route.indexOf("getBrokerPointsStatement(brokerId"));
  const lib = readFileSync(new URL("../lib/points-statement.js", import.meta.url), "utf8");
  assert.match(lib, /isBrokerInScope\(scope, id\)/);
  assert.match(lib, /getPointsLedger\(\{ period \}, auth\)/); // sem brokerId: mesma base do selo
  assert.ok(!/getRulePointsAt|rulesTimeline/.test(lib), "nenhuma fórmula nova de pontuação");
});

test("card: o selo é um botão que não deixa o clique/teclado subir para o card", () => {
  const card = readFileSync(new URL("../components/TeamDailyPerformance.jsx", import.meta.url), "utf8");
  assert.match(card, /event\.stopPropagation\(\); onOpenStatement\?\.\(\)/);
  assert.match(card, /onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(card, /expectedPoints=\{statementBroker\.ranking\?\.points \?\? null\}/);
});
