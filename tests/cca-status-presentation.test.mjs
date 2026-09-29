import test from 'node:test';
import assert from 'node:assert/strict';
import { daysSince, ccaStatusDayColorKey, ccaStatusBadgeLabel, CCA_STATUS_DAY_THRESHOLDS } from '../lib/cca-status-presentation.mjs';

test('daysSince converts an ISO date into whole days elapsed', () => {
  const now = Date.now();
  assert.equal(daysSince(new Date(now).toISOString()), 0);
  assert.equal(daysSince(new Date(now - 3 * 86400000).toISOString()), 3);
  assert.equal(daysSince(null), 0);
});

test('color bands: green up to 2 days, yellow up to 5, red above that', () => {
  assert.equal(ccaStatusDayColorKey(0), "green");
  assert.equal(ccaStatusDayColorKey(CCA_STATUS_DAY_THRESHOLDS.green), "green");
  assert.equal(ccaStatusDayColorKey(CCA_STATUS_DAY_THRESHOLDS.green + 1), "yellow");
  assert.equal(ccaStatusDayColorKey(CCA_STATUS_DAY_THRESHOLDS.yellow), "yellow");
  assert.equal(ccaStatusDayColorKey(CCA_STATUS_DAY_THRESHOLDS.yellow + 1), "red");
  assert.equal(ccaStatusDayColorKey(30), "red");
});

test('badge label: first status shows "Aguardando retorno de {CCA}"', () => {
  assert.equal(
    ccaStatusBadgeLabel({ statusKey: "awaiting_cca_return", statusLabel: "Aguardando retorno da CCA", ccaName: "Banco X" }),
    "Aguardando retorno de Banco X"
  );
});

test('badge label: other statuses show "{status} — {CCA}"', () => {
  assert.equal(
    ccaStatusBadgeLabel({ statusKey: "approved", statusLabel: "Aprovado", ccaName: "Banco X" }),
    "Aprovado — Banco X"
  );
  assert.equal(
    ccaStatusBadgeLabel({ statusKey: "rejected", statusLabel: "Reprovado", ccaName: "" }),
    "Reprovado"
  );
});
