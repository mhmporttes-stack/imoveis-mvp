import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 1.1.6 (dono, 25/10/2026): "abro outra janela para utilizar, em tela cheia; as duas abas das extensões ficam abertas
// atrás dessa." Leitura do botão e cliques do perfil com a página acordada pelo depurador (emulação de foco).
const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

test('lib/page-awake.js é cópia idêntica da do marketplace-publicador (uma regra só)', () => {
  assert.equal(ler('../lib/page-awake.js'), ler('../../marketplace-publicador/lib/page-awake.js'));
});

test('leitura e cliques na tela rodam com a página acordada; a leitura da sessão não liga o depurador; nunca traz a janela para a frente', () => {
  const tela = ler('../instagram-tela.js');
  const executar = tela.slice(tela.indexOf('export async function executarNaAba('), tela.indexOf('export async function procurarNaListaNaAba('));
  assert.match(executar, /return acordar \? paginaAcordada\.run\(tabId, rodar\) : rodar\(\);/);
  assert.match(tela, /func: lerSessaoNaPagina, args: \[TEXTOS\], acordar: false/);
  assert.match(tela, /export async function procurarNaListaNaAba[\s\S]*?return paginaAcordada\.run\(tabId, async \(info\) =>/);
  assert.match(tela, /export async function digitarDmNaAba[\s\S]*?return paginaAcordada\.run\(tabId, async \(info\) =>/);
  assert.doesNotMatch(tela, /bringToFront/);
  const manifest = JSON.parse(ler('../manifest.json'));
  assert.ok(manifest.permissions.includes('debugger'));
  const [maior, menor] = manifest.version.split('.').map(Number);
  assert.ok(maior > 1 || (maior === 1 && menor >= 2), manifest.version);
});
