// Registro de toques e aberturas da apresentação (Mesa "Atendimento depois da simulação", lote A item 3, dono 2026-10-19):
// tabela aditiva simulation_presentation_events, alvo fechado, cena exata, marca "equipe" decidida no servidor da página,
// sem IP/user-agent e tolerante à migration ainda não aplicada.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const stripComments = (code) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");
const MIGRATION = "supabase/migrations/20261020100000_simulation_presentation_events.sql";

test("migration: aditiva, nome de 14 dígitos, RLS ligado sem policy, alvos fechados e nenhum dado pessoal", () => {
  assert.match(path.basename(MIGRATION), /^\d{14}_[a-z0-9_]+\.sql$/);
  const sql = stripComments(read(MIGRATION));
  assert.match(sql, /create table if not exists public\.simulation_presentation_events/);
  assert.match(sql, /presentation_id uuid not null references public\.simulation_presentations\(id\) on delete cascade/);
  assert.match(sql, /alvo in \('estrategia', 'agendar', 'imoveis', 'lista', 'validar', 'baixar'\)/);
  assert.match(sql, /equipe boolean not null default false/);
  assert.match(sql, /enable row level security/);
  assert.ok(!/create policy/i.test(sql));
  assert.ok(!/\b(drop|truncate|delete from|alter table public\.simulation_presentations\b)/i.test(sql));
  assert.ok(!/\b(ip|user_agent|phone|telefone|cpf)\b/i.test(sql));
});

test("lib: toque grava só na tabela nova; tabela ausente = log e segue (o deploy não depende da migration)", () => {
  const lib = stripComments(read("lib/simulation-presentation.js"));
  const insert = /async function insertPresentationEventRow[\s\S]*?\n}\n/.exec(lib)?.[0] || "";
  assert.match(insert, /if \(isPresentationSchemaMissing\(error\)\) \{\s*console\.warn\(/);
  assert.match(insert, /throw error;/); // outros erros não são escondidos
  const record = /export async function recordPresentationEvent[\s\S]*?\n}\n/.exec(lib)?.[0] || "";
  assert.match(record, /if \(tipo === "toque"\) \{[\s\S]*?insertPresentationEventRow\(presentationId, \{ tipo, alvo, cena, equipe \}\)/);
  // a marca "equipe" só confere o token de acesso (sem renovar sessão) e nunca entra no DTO
  const viewer = /export async function isPanelSessionViewer[\s\S]*?\n}\n/.exec(lib)?.[0] || "";
  assert.match(viewer, /verifyAdminAccessToken\(accessToken\)/);
  assert.ok(!/refresh/i.test(viewer));
});

test("página e player: equipe vem do servidor como prop (fora do DTO); toques com alvo e cena exata, só no link real", () => {
  const page = stripComments(read("app/apresentacao/[token]/page.jsx"));
  assert.match(page, /isPanelSessionViewer\(\)/);
  assert.match(page, /teamViewer=\{teamViewer === true\}/);
  const player = stripComments(read("components/presentation/PresentationPlayer.jsx"));
  assert.match(player, /const touch = useCallback\(\(alvo\) => \{\s*if \(!tracking\) return;\s*const body = \{ tipo: "toque", alvo, cena: stateRef\.current\.index \+ 1 \};/);
  for (const alvo of ["validar", "lista", "agendar", "estrategia", "imoveis", "baixar"]) assert.match(player, new RegExp(`touch\\("${alvo}"\\)`), alvo);
  assert.match(player, /validate: touched\.validar, openForecast: touched\.lista/);
  assert.match(player, /openAppointment: touched\.agendar/);
  assert.match(player, /openStrategy: touched\.estrategia/);
  assert.match(player, /openProperties: touched\.imoveis, onDownload: touched\.baixar/);
  const route = stripComments(read("app/api/s/[token]/evento/route.js"));
  assert.ok(!/x-forwarded-for|x-real-ip|user_agent|userAgent:/i.test(route));
});
