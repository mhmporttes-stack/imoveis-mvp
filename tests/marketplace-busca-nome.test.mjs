// Busca pelo nome na lista do Chat do Marketplace (dono, 2026-10-29): "O Marketplace não tem a caixa de busca lá em cima
// pelo nome do cliente. Precisa ter." Busca no servidor, sem acento/maiúscula, sempre dentro do escopo do Chat (MKT-2d).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MARKETPLACE_SEARCH_MAX_LENGTH, marketplaceSearchRegex, normalizeMarketplaceSearch } from "../lib/marketplace-chat-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
// Mesma semântica do `~*` do Postgres para estes padrões (classes, `.+`, letras/números).
const matches = (term, text) => new RegExp(marketplaceSearchRegex(term), "i").test(text);

test("termo da busca: sem acento, minúsculo, só letras/números, com limite de tamanho", () => {
  assert.equal(normalizeMarketplaceSearch("  JOÃO  da Conceição "), "joao da conceicao");
  assert.equal(normalizeMarketplaceSearch("Ana, (Paula)%_*\\\"'.:"), "ana paula");
  assert.equal(normalizeMarketplaceSearch("   "), "");
  assert.equal(normalizeMarketplaceSearch(null), "");
  assert.equal(normalizeMarketplaceSearch("a".repeat(200)).length, MARKETPLACE_SEARCH_MAX_LENGTH);
});

test("padrão nunca leva caractere reservado do filtro do PostgREST (vírgula, parênteses, aspas, curingas)", () => {
  for (const raw of ["a,b", "x)or(id.eq.1", 'name"."', "%", "_", "*", "\\", "maria.silva"]) {
    assert.doesNotMatch(marketplaceSearchRegex(raw), /[,()"'%*\\]/, raw);
  }
  assert.equal(marketplaceSearchRegex(""), "");
  assert.equal(marketplaceSearchRegex("!!!"), "");
});

test("acha com e sem acento, em maiúscula ou minúscula, e palavras na ordem", () => {
  assert.ok(matches("joao", "João Pedro"));
  assert.ok(matches("JOÃO", "joao pedro"));
  assert.ok(matches("conceicao", "MARIA DA CONCEIÇÃO"));
  assert.ok(matches("Conceição", "Maria da Conceicao"));
  assert.ok(matches("maria conceicao", "Maria da Conceição"));
  assert.ok(matches("ana", "Juliana"));
  assert.ok(matches("apto 2", "Apto 2 quartos Jardim"));
  assert.ok(!matches("conceicao maria", "Maria da Conceição"), "palavras na ordem");
  assert.ok(!matches("pedro", "João Paulo"));
});

test("lista: a busca usa a MESMA base com escopo + seletor nas duas consultas (nunca amplia o escopo)", () => {
  const lib = read("lib/marketplace-chat.js");
  const list = lib.slice(lib.indexOf("export async function listMarketplaceConversations"), lib.indexOf("async function loadScopedConversation"));
  assert.equal(list.match(/\.from\(CONVERSATIONS\)/g)?.length, 1, "uma única base de consulta");
  const scoped = list.slice(list.indexOf("const scoped = (columns) =>"), list.indexOf("let rows;"));
  assert.match(scoped, /if \(!scope\.all\) query = query\.in\("assigned_user_id", scope\.ids\);/);
  assert.match(scoped, /if \(filterId\) query = query\.eq\("assigned_user_id", filterId\);/);
  assert.match(list, /scoped\("\*"\)\.or\(`contact_name\.imatch\."\$\{pattern\}",listing_title\.imatch\."\$\{pattern\}"`\)/);
  assert.match(list, /scoped\(`\*, \$\{CLIENT_NAME_EMBED\}`\)\.filter\("mc\.full_name", "imatch", pattern\)/);
  assert.match(lib, /const CLIENT_NAME_EMBED = "mc:simulation_registrations!client_id!inner\(full_name\)";/);
  assert.match(list, /const filterId = allowedBrokerFilter\(scope, brokerId\);[\s\S]*if \(filterId === null[^\n]*return empty;[\s\S]*const scoped/, "corretor fora do escopo = lista vazia antes de qualquer busca");
  // O nome do cliente ligado só filtra: a linha devolvida é a de sempre (conversationRow), sem o nome da ficha.
  assert.doesNotMatch(lib.slice(lib.indexOf("function conversationRow"), lib.indexOf("async function userNames")), /full_name|\bmc\b/);
});

test("rota repassa ?q= e mantém o guard; tela manda a busca ao servidor e não guarda o resultado no cache", () => {
  const route = read("app/api/admin/marketplace-chat/conversations/route.js");
  assert.match(route, /requireAdminApi\(request\)/);
  assert.match(route, /search: params\.get\("q"\) \|\| ""/);
  const screen = read("components/marketplace/MarketplaceChat.jsx");
  assert.match(screen, /if \(search\) params\.set\("q", search\);/);
  assert.match(screen, /placeholder="Buscar pelo nome do cliente"/);
  assert.match(screen, /aria-label="Limpar busca"/);
  assert.match(screen, /if \(!search\) saveViewerData\(/);
  assert.match(screen, /if \(viewKeyRef\.current !== key\) return;/, "resposta de busca antiga é descartada");
  assert.match(screen, /<option value="">Todos<\/option>/, "seletor por corretor continua");
});
