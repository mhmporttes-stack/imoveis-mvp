import test from "node:test";
import assert from "node:assert/strict";
import { parseBrazilianDecimal, parseBrazilianMoney } from "../lib/money-br.mjs";
import { isFullyReceived, receiptTargetCents, receivedCentsOf, remainingToReceiveCents } from "../lib/financial-receipt-basis.mjs";

// Regressão da auditoria incremental 2026-10-02: "1.500" virava R$ 1,50 (o ponto era lido como decimal).
test("valor brasileiro: os quatro formatos do pedido do dono", () => {
  assert.equal(parseBrazilianMoney("1.500"), 1500);
  assert.equal(parseBrazilianMoney("1.500,50"), 1500.5);
  assert.equal(parseBrazilianMoney("1500"), 1500);
  assert.equal(parseBrazilianMoney("1500,50"), 1500.5);
});

test("valor brasileiro: milhar, moeda, decimais e entradas limite", () => {
  assert.equal(parseBrazilianMoney("R$ 1.500,00"), 1500);
  assert.equal(parseBrazilianMoney("3.000"), 3000);
  assert.equal(parseBrazilianMoney("10.000"), 10000);
  assert.equal(parseBrazilianMoney("1.234.567"), 1234567);
  assert.equal(parseBrazilianMoney("1.234.567,89"), 1234567.89);
  assert.equal(parseBrazilianMoney("2866,10"), 2866.1);
  assert.equal(parseBrazilianMoney("1500.50"), 1500.5, "ponto com 2 casas = decimal (como vem do banco/JSON)");
  assert.equal(parseBrazilianMoney("9000.00"), 9000);
  assert.equal(parseBrazilianMoney("31527.1"), 31527.1);
  assert.equal(parseBrazilianMoney("0.500"), 0.5, "grupo de milhar nunca começa com zero");
  assert.equal(parseBrazilianMoney("-1.500"), -1500);
  assert.equal(parseBrazilianMoney(1500.5), 1500.5);
  assert.equal(parseBrazilianMoney(""), 0);
  assert.equal(parseBrazilianMoney(null), 0);
  assert.equal(parseBrazilianMoney("abc"), 0);
});

test("percentual NÃO usa a regra de milhar: '2.125' é 2,125%", () => {
  assert.equal(parseBrazilianDecimal("2.125"), 2.125);
  assert.equal(parseBrazilianDecimal("6,25"), 6.25);
  assert.equal(parseBrazilianDecimal("12"), 12);
  assert.equal(parseBrazilianDecimal("6,25%"), 6.25);
});

test("base única de recebimento: bruta, recebido = pagamentos 'received', saldo e 'recebida'", () => {
  const payments = [{ status: "received", amount: 7650 }, { status: "expected", amount: 1000, expectedDate: "2026-11-01" }];
  assert.equal(receiptTargetCents(9000), 900000);
  assert.equal(receivedCentsOf(payments), 765000);
  assert.equal(remainingToReceiveCents({ grossCommission: 9000, payments }), 135000);
  assert.equal(isFullyReceived({ grossCommission: 9000, payments }), false);
  assert.equal(isFullyReceived({ grossCommission: 9000, payments: [{ status: "received", amount: 9000 }] }), true);
  assert.equal(isFullyReceived({ grossCommission: 0, payments: [] }), false);
  assert.equal(remainingToReceiveCents({ grossCommission: 9000, payments: [{ status: "received", amount: 9500 }] }), 0);
  assert.equal(isFullyReceived({ grossCommission: 0.1 + 0.2, payments: [{ status: "received", amount: 0.3 }] }), true, "centavos: sem erro de ponto flutuante");
});
