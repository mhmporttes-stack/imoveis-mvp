// CLI-7a (REGRA OFICIAL, dono 2026-10-16): o corretor transfere o PRÓPRIO cliente para dono/gestor/outro corretor ativo.
// Associado não transfere; nunca para associado, inativo ou "sem responsável"; nunca cliente de outra pessoa.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  brokerTransferDenial,
  brokerTransferTargets,
  canBrokerTransferOwnClients,
  isBrokerTransferTarget
} from "../lib/broker-client-transfer-core.mjs";

const broker = { id: "b1", role: "broker", status: "active", name: "Bruna" };
const owner = { id: "o1", role: "admin", status: "active", name: "Matheus" };
const manager = { id: "m1", role: "manager", status: "active", name: "Carol" };
const other = { id: "b2", role: "broker", status: "active", name: "Izabela" };
const associate = { id: "a1", role: "associate", status: "active", name: "Associada", linkedBrokerId: "b1" };
const inactive = { id: "b3", role: "broker", status: "inactive", name: "Saiu" };

test("só corretor (não associado, não perfil provisório) transfere os próprios clientes", () => {
  assert.equal(canBrokerTransferOwnClients(broker), true);
  assert.equal(canBrokerTransferOwnClients(associate), false);
  assert.equal(canBrokerTransferOwnClients(manager), false);
  assert.equal(canBrokerTransferOwnClients(owner), false);
  assert.equal(canBrokerTransferOwnClients({ ...broker, isFallback: true }), false);
  assert.equal(canBrokerTransferOwnClients({ ...broker, id: "" }), false);
});

test("destinos: dono, gestora e outro corretor ativos; nunca associado, inativo nem ele mesmo", () => {
  for (const target of [owner, manager, other]) assert.equal(isBrokerTransferTarget(target, broker.id), true, target.name);
  for (const target of [associate, inactive, broker, null, {}]) assert.equal(isBrokerTransferTarget(target, broker.id), false);
  const list = brokerTransferTargets([broker, owner, manager, other, associate, inactive], broker.id);
  assert.deepEqual(list.map((item) => item.id).sort(), ["b2", "m1", "o1"]);
  assert.deepEqual(Object.keys(list[0]).sort(), ["id", "name"], "a tela do corretor só recebe id e nome");
});

test("decisão: cliente dele -> pode; de outra pessoa, sem responsável ou destino inválido -> recusa", () => {
  assert.equal(brokerTransferDenial({ actor: broker, currentResponsibleUserId: "b1", target: manager }), "");
  assert.equal(brokerTransferDenial({ actor: broker, currentResponsibleUserId: "b1", target: owner }), "");
  assert.equal(brokerTransferDenial({ actor: broker, currentResponsibleUserId: "b1", target: other }), "");
  assert.match(brokerTransferDenial({ actor: broker, currentResponsibleUserId: "b2", target: manager }), /responsável/);
  assert.match(brokerTransferDenial({ actor: broker, currentResponsibleUserId: null, target: manager }), /responsável/);
  assert.match(brokerTransferDenial({ actor: broker, currentResponsibleUserId: "b1", target: associate }), /ativo/);
  assert.match(brokerTransferDenial({ actor: broker, currentResponsibleUserId: "b1", target: inactive }), /ativo/);
  assert.match(brokerTransferDenial({ actor: broker, currentResponsibleUserId: "b1", target: null }), /ativo/);
  assert.notEqual(brokerTransferDenial({ actor: associate, currentResponsibleUserId: "b1", target: manager }), "", "associado não transfere");
});

test("servidor: a barreira está em updateSimulationRegistration, no mesmo caminho da transferência manual", () => {
  const lib = fs.readFileSync(new URL("../lib/simulation-registrations.js", import.meta.url), "utf8");
  const block = lib.slice(lib.indexOf("if (updates.responsibleUserId !== undefined) {"), lib.indexOf("if (updates.fullName !== undefined)"));
  assert.match(block, /canBrokerTransferOwnClients\(auth\.profile\)/);
  assert.match(block, /!isGeneralAdminAuth\(auth\)/);
  assert.match(block, /brokerTransferDenial\(\{ actor: auth\.profile, currentResponsibleUserId: previousResponsibleUserId, target \}\)/);
  assert.match(block, /if \(denial\) throw new AdminPermissionError\(denial\);/);
  assert.match(block, /else if \(nextResponsibleUserId\) assertCanAccessResponsibleUser\(auth, nextResponsibleUserId\);/, "admin/gestor seguem a CLI-7");
  assert.match(block, /else assertGeneralAdminOrManager\(auth\);/, "sem responsável continua só admin/gestor");
  assert.match(block, /record\.previous_responsible_user_id = previousResponsibleUserId;/);
  assert.match(lib, /if \(brokerTransferTarget\) await notifyBrokerTransferRecipient\(/);
  assert.match(lib, /notification_type: "clients_transferred"/);
});

test("tela: o seletor do corretor só aparece no cliente dele e pede confirmação", () => {
  const hook = fs.readFileSync(new URL("../components/clients/useClientList.js", import.meta.url), "utf8");
  assert.match(hook, /client\?\.registration\?\.responsibleUserId === ownTransfer\.selfId/);
  assert.match(hook, /title: "Transferir o cliente\?"/);
  const page = fs.readFileSync(new URL("../app/admin/simulacoes/page.jsx", import.meta.url), "utf8");
  assert.match(page, /const canTransferOwnClients = !isGeneralAdmin && canBrokerTransferOwnClients\(auth\.profile\);/);
});
