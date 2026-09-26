import test from 'node:test';
import assert from 'node:assert/strict';
import { isNamelessContactName, moveNamelessToEnd } from '../lib/prospecting-queue-order.mjs';

test('nomes que contam como "sem nome"', () => {
  for (const name of ['Sem Nome', 'sem nome', '  SEM  NOME ', 'Sem-nome', 'SEM NOME CADASTRADO', 'Cliente', 'contato', 'Desconhecido', 'N/A', '', '   ', null, undefined, '.', '-', '5520000000000', '5514997019849', '(14) 99701-9849', '+55 14 99701-9849', 's', 'A']) {
    assert.equal(isNamelessContactName(name), true, JSON.stringify(name));
  }
});

test('nomes de verdade (inclusive apelidos curtos e com acento) ficam na ordem normal', () => {
  for (const name of ['Maria', 'João', 'Ana', 'Lu', 'Jo', 'Zé', 'Maria da Silva', 'José Carlos', 'Matheus Machado', 'A. Souza', 'Cliente João']) {
    assert.equal(isNamelessContactName(name), false, name);
  }
});

test('sem nome vai para o final e a ordem original é mantida dentro de cada grupo', () => {
  const rows = [
    { id: 1, name: 'Sem Nome' },
    { id: 2, name: 'Maria' },
    { id: 3, name: '5514997019849' },
    { id: 4, name: 'João' },
    { id: 5, name: 'sem nome' },
    { id: 6, name: 'Ana' }
  ];
  assert.deepEqual(moveNamelessToEnd(rows).map((row) => row.id), [2, 4, 6, 1, 3, 5]);
});

test('lista vazia, sem nomes ou só com nomes não muda nada de errado', () => {
  assert.deepEqual(moveNamelessToEnd([]), []);
  assert.deepEqual(moveNamelessToEnd(undefined), []);
  assert.deepEqual(moveNamelessToEnd([{ name: 'Ana' }, { name: 'Bia' }]).map((row) => row.name), ['Ana', 'Bia']);
  assert.deepEqual(moveNamelessToEnd([{ name: '.' }, { name: '-' }]).map((row) => row.name), ['.', '-']);
});
