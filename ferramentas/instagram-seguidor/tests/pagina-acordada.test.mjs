import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 1.1.6 (dono, 25/10/2026): "abro outra janela para utilizar, em tela cheia; as duas abas das extensões ficam abertas
// atrás dessa." Leitura do botão e cliques do perfil com a página acordada pelo depurador (emulação de foco).
const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

test('lib/page-awake.js é cópia idêntica da do marketplace-publicador (uma regra só)', () => {
  assert.equal(ler('../lib/page-awake.js'), ler('../../marketplace-publicador/lib/page-awake.js'));
});

test('leitura do botão e cliques do perfil rodam com a página acordada; API não liga o depurador; nunca traz a janela para a frente', () => {
  const api = ler('../instagram-api.js');
  // 1.1.12: abrirPerfilComRastro (com rastro + esqueleto para o diagnóstico) substituiu abrirPerfilEExecutar.
  const abrir = api.slice(api.indexOf('async function abrirPerfilComRastro('), api.indexOf('/** 1.1.4: abre o perfil'));
  assert.match(abrir, /paginaAcordada\.run\(tabId, async \(info\) => \{[\s\S]*?await chrome\.tabs\.update\(tabId/);
  assert.match(api, /return abrirPerfilComRastro\(username, async \(\{ exec, rastro \}\) => \{\s*const r = await exec\(lerEstadoNaPagina, \[textosLeitura\(\)\]\)/);
  assert.match(api, /const r = await exec\(clicarNaPagina, \[passos\]\)/);
  const executar = api.slice(api.indexOf('export async function executarNaAba('), api.indexOf('/** Lê a sessão do navegador'));
  assert.doesNotMatch(executar, /paginaAcordada|debugger/);
  assert.doesNotMatch(api, /bringToFront/);
  const manifest = JSON.parse(ler('../manifest.json'));
  assert.ok(manifest.permissions.includes('debugger'));
  // A página acordada existe desde a 1.1.6 (versões seguintes mantêm).
  const [maior, menor, rev] = manifest.version.split('.').map(Number);
  assert.ok(maior > 1 || (maior === 1 && (menor > 1 || (menor === 1 && rev >= 6))), manifest.version);
});
