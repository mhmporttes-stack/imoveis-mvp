import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSupabaseAdminClient } from "./supabase";
import { getSimulation } from "./simulations";
import { normalizeClientStatus, CLIENT_STATUS } from "./client-status";
import { canReceiveDocumentsList } from "./simulation-presentation";
import { buildPaymentStrategyBase, firstNameOf, isPresentationToken } from "./simulation-presentation-core.mjs";
import { buildBrokerWhatsappUrl } from "./documents-forecast-core.mjs";
import { buildStrategyMessage, compareStrategy, strategySummary } from "./payment-strategy-core.mjs";
import { generatePaymentStrategyPdf, strategyPdfFileName } from "./payment-strategy-pdf.mjs";
import { formatBRL } from "./simulation-presentation-format.mjs";

// "Estratégia de pagamento" da apresentação (PRES-24). Leitura/gravação no banco desta funcionalidade. As escolhas ficam na
// linha do link (`simulation_presentations.payment_strategy*`, migration 20261018120000): enquanto a migration não estiver
// aplicada, a estratégia FUNCIONA normalmente (cálculo, PDF, WhatsApp) e só a gravação é pulada (log).

const TABLE = "simulation_presentations";

function client() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase administrativo não configurado.");
  return supabase;
}

function isStrategyColumnMissing(error) {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  return ["42703", "PGRST204"].includes(String(error.code || "")) || (message.includes("payment_strategy") && (message.includes("does not exist") || message.includes("schema cache")));
}

function dateTextNow() {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
}

let logoPromise = null;
async function loadLogo(origin) {
  if (!logoPromise) {
    logoPromise = readFile(path.join(process.cwd(), "public", "assets", "matheus-machado-symbol.png")).catch(() => null);
  }
  const bytes = await logoPromise;
  if (bytes) return bytes;
  // Em produção (Vercel) o arquivo estático pode não estar no bundle da função: busca pelo próprio site.
  try {
    const response = await fetch(new URL("/assets/matheus-machado-symbol.png", origin));
    return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** PDF da estratégia para uma simulação já autorizada. `null` quando a simulação não tem base (sem taxa/prazo/financiamento). */
export async function buildPaymentStrategyPdf({ simulation, choices, origin }) {
  const base = buildPaymentStrategyBase(simulation);
  const comparison = compareStrategy(base, choices);
  if (!comparison) return null;
  const firstName = firstNameOf(simulation.clientName);
  const bytes = await generatePaymentStrategyPdf({ base, choices, comparison, firstName, dateText: dateTextNow(), logoBytes: await loadLogo(origin) });
  return { bytes, fileName: strategyPdfFileName(firstName), comparison, base };
}

/**
 * Link público → simulação + base. Resultados: { kind:"not_found" } | { kind:"no_strategy" } | { kind:"ok", presentationId, simulation, base, blocked }.
 * `blocked` = cliente "Não contactar" (nada é gravado e o WhatsApp não é devolvido).
 */
async function loadByToken(token) {
  if (!isPresentationToken(token)) return { kind: "not_found" };
  const { data, error } = await client().from(TABLE).select("id, simulation_id, status").eq("token", token).maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "active") return { kind: "not_found" };
  const simulation = await getSimulation(data.simulation_id);
  if (!simulation) return { kind: "not_found" };
  const base = buildPaymentStrategyBase(simulation);
  if (!base) return { kind: "no_strategy" };
  const blocked = normalizeClientStatus(simulation.registration?.status) === CLIENT_STATUS.DO_NOT_CONTACT;
  return { kind: "ok", presentationId: data.id, simulation, base, blocked };
}

async function saveChoices(presentationId, { choices, comparison, action }) {
  const now = new Date().toISOString();
  const { error } = await client()
    .from(TABLE)
    .update({ payment_strategy: { escolhas: choices, resumo: strategySummary(comparison), acao: action, salvoEm: now }, payment_strategy_at: now })
    .eq("id", presentationId)
    .eq("status", "active");
  if (isStrategyColumnMissing(error)) {
    console.warn("[estrategia] escolhas nao gravadas: migration 20261018120000 ainda nao aplicada");
    return false;
  }
  if (error) throw error;
  return true;
}

/** Endpoint público, ação "pdf": grava as escolhas (menos "Não contactar") e devolve o PDF. */
export async function paymentStrategyPdfByToken(token, choices, origin) {
  const loaded = await loadByToken(token);
  if (loaded.kind !== "ok") return loaded;
  const result = await buildPaymentStrategyPdf({ simulation: loaded.simulation, choices, origin });
  if (!result) return { kind: "no_strategy" };
  if (!loaded.blocked) await saveChoices(loaded.presentationId, { choices, comparison: result.comparison, action: "pdf" });
  return { kind: "ok", bytes: result.bytes, fileName: result.fileName };
}

/**
 * Endpoint público, ação "contato" ("Falar com meu corretor"): grava as escolhas e devolve o link do WhatsApp com a mensagem
 * pronta pelo MESMO caminho dos outros botões da apresentação (`buildBrokerWhatsappUrl`, PRES-17/PRES-22). O link só sai
 * quando há responsável ativo com WhatsApp válido (mesma condição do botão: `canReceiveDocumentsList`).
 */
export async function paymentStrategyContactByToken(token, choices) {
  const loaded = await loadByToken(token);
  if (loaded.kind !== "ok") return loaded;
  if (loaded.blocked) return { kind: "blocked" };
  const comparison = compareStrategy(loaded.base, choices);
  await saveChoices(loaded.presentationId, { choices, comparison, action: "contato" });
  if (!(await canReceiveDocumentsList(loaded.simulation))) return { kind: "ok", url: "" };
  const message = buildStrategyMessage({ firstName: firstNameOf(loaded.simulation.clientName), comparison, formatMoney: formatBRL });
  return { kind: "ok", url: buildBrokerWhatsappUrl(loaded.simulation.registration?.id || loaded.simulation.registrationId, message) };
}

/** Última estratégia gravada pelo link (CRM: painel e prévia). Coluna ausente = null. */
export async function readPaymentStrategy(presentationId) {
  if (!presentationId) return null;
  const { data, error } = await client().from(TABLE).select("payment_strategy, payment_strategy_at").eq("id", presentationId).maybeSingle();
  if (isStrategyColumnMissing(error)) return null;
  if (error) throw error;
  if (!data?.payment_strategy) return null;
  return { ...data.payment_strategy, salvoEm: data.payment_strategy_at || data.payment_strategy.salvoEm || "" };
}
