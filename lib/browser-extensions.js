import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { verifyPublisherToken } from "./marketplace-listings";
import { getMarketplaceChatSettings, getMarketplaceExtensionSignal } from "./marketplace-chat";
import {
  CONFIG_FIELDS,
  CONTROL_SETTING_ID,
  EXTENSIONS,
  EXTENSION_KEYS,
  INSTAGRAM_TOKEN_SETTING_ID,
  buildExtensionHealthView,
  buildExtensionRuntime,
  configSettingId,
  extensionForToken,
  healthSettingId,
  isExtensionKey,
  mergeHealth,
  normalizeControl,
  normalizeExtensionConfig,
  normalizeHealthReport
} from "./browser-extensions-core.mjs";
import instagramManifest from "../ferramentas/instagram-seguidor/manifest.json";
import marketplaceManifest from "../ferramentas/marketplace-publicador/manifest.json";

// Extensões do Chrome do dono (EXT-1, dono, 2026-10-29). Tudo em crm_settings (sem migration). A tela é só do admin
// geral real (app/admin/extensoes, guard requireRealGeneralAdminApi nas rotas); as extensões falam com o CRM pela
// chave pessoal de cada uma (mkp_… do Marketplace, igs_… do Seguidor) — authenticateExtensionRequest.

export class ExtensionInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Versão mais nova = a do código no repositório (manifest.json empacotado no build). O zip é gerado do mesmo código
// (scripts/gerar-zips-extensoes.mjs; tests/extensoes-zip.test.mjs falha se divergir).
export const LATEST_VERSIONS = Object.freeze({ instagram: instagramManifest.version, marketplace: marketplaceManifest.version });

export function extensionDownloadPath(ext) {
  return `/api/admin/extensoes/download?ext=${encodeURIComponent(ext)}`;
}

function db() {
  if (!hasSupabaseAdminConfig) throw new Error("Supabase administrativo não configurado.");
  return getSupabaseAdminClient();
}

async function readSettings(ids) {
  const { data, error } = await db().from("crm_settings").select("id, setting_value, updated_at").in("id", ids);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.id, row]));
}

async function readSetting(id) {
  return (await readSettings([id])).get(id)?.setting_value || null;
}

async function writeSetting(id, value, userId = null) {
  const row = { id, setting_value: value, updated_at: new Date().toISOString() };
  if (userId) row.updated_by = userId;
  const { error } = await db().from("crm_settings").upsert(row, { onConflict: "id" });
  if (error) throw error;
}

// --- Chave do Seguidor do Instagram (mesmo padrão da mkp_ do Marketplace: só o hash fica guardado) -------------------
const hashToken = (token) => createHash("sha256").update(String(token || "")).digest("hex");

export async function generateInstagramExtensionToken(auth) {
  const token = `${EXTENSIONS.instagram.tokenPrefix}${randomBytes(24).toString("hex")}`;
  await writeSetting(INSTAGRAM_TOKEN_SETTING_ID, { token_hash: hashToken(token), token_created_at: new Date().toISOString() }, auth?.profile?.id || null);
  return token;
}

async function verifyInstagramExtensionToken(token) {
  const stored = String((await readSetting(INSTAGRAM_TOKEN_SETTING_ID))?.token_hash || "");
  const supplied = hashToken(token);
  return stored.length > 0 && stored.length === supplied.length && timingSafeEqual(Buffer.from(stored), Buffer.from(supplied));
}

// Bearer → "instagram" | "marketplace" | "" (chave inválida). A rota decide o limite por IP antes.
export async function authenticateExtensionToken(token) {
  const ext = extensionForToken(token);
  if (ext === "marketplace") return (await verifyPublisherToken(token).catch(() => false)) ? ext : "";
  if (ext === "instagram") return (await verifyInstagramExtensionToken(token)) ? ext : "";
  return "";
}

// --- Lado da extensão -------------------------------------------------------------------------------------------
export async function getExtensionRuntime(ext, { runningVersion = "", origin = "" } = {}) {
  const settings = await readSettings([CONTROL_SETTING_ID, configSettingId(ext)]);
  return buildExtensionRuntime(ext, {
    control: settings.get(CONTROL_SETTING_ID)?.setting_value,
    config: settings.get(configSettingId(ext))?.setting_value,
    latestVersion: LATEST_VERSIONS[ext],
    runningVersion,
    downloadUrl: `${origin}${extensionDownloadPath(ext)}`
  });
}

export async function recordExtensionHealth(ext, body, { version = "", now = new Date() } = {}) {
  const id = healthSettingId(ext);
  const previous = await readSetting(id);
  await writeSetting(id, mergeHealth(previous, normalizeHealthReport(body), { now, version }));
}

// --- Lado do dono (tela Extensões) -----------------------------------------------------------------------------------
export async function getExtensionsOverview(now = new Date()) {
  const ids = [CONTROL_SETTING_ID, INSTAGRAM_TOKEN_SETTING_ID, ...EXTENSION_KEYS.flatMap((ext) => [configSettingId(ext), healthSettingId(ext)])];
  const [settings, marketplaceSignal, chatSettings] = await Promise.all([
    readSettings(ids),
    getMarketplaceExtensionSignal().catch(() => null),
    getMarketplaceChatSettings().catch(() => null)
  ]);
  const value = (id) => settings.get(id)?.setting_value || null;
  const extensions = EXTENSION_KEYS.map((ext) => ({
    key: ext,
    label: EXTENSIONS[ext].label,
    fields: CONFIG_FIELDS[ext],
    config: normalizeExtensionConfig(ext, value(configSettingId(ext))),
    configUpdatedAt: settings.get(configSettingId(ext))?.updated_at || null,
    downloadUrl: extensionDownloadPath(ext),
    health: buildExtensionHealthView(value(healthSettingId(ext)), {
      latestVersion: LATEST_VERSIONS[ext],
      now,
      // Marketplace: o sinal da sincronização (MKT-2g) também diz a versão e a última chamada.
      fallbackVersion: ext === "marketplace" ? marketplaceSignal?.extensionVersion || "" : "",
      fallbackSignalAt: ext === "marketplace" ? marketplaceSignal?.lastSignalAt || null : null
    })
  }));
  const instagramToken = value(INSTAGRAM_TOKEN_SETTING_ID);
  return {
    control: normalizeControl(value(CONTROL_SETTING_ID)),
    extensions,
    instagramToken: { configured: Boolean(instagramToken?.token_hash), createdAt: instagramToken?.token_created_at || null },
    marketplaceChat: chatSettings ? { syncEnabled: chatSettings.syncEnabled, startHour: chatSettings.startHour, endHour: chatSettings.endHour, maxSendsPerHour: chatSettings.maxSendsPerHour } : null
  };
}

export async function saveExtensionConfig(ext, input, auth) {
  if (!isExtensionKey(ext)) throw new ExtensionInputError("Extensão desconhecida.");
  const config = normalizeExtensionConfig(ext, input);
  await writeSetting(configSettingId(ext), config, auth?.profile?.id || null);
  return config;
}

// "Parar tudo"/"Retomar": vale para as duas extensões na próxima consulta (antes de cada ação).
export async function setExtensionsStopped(stopped, auth) {
  const control = { stopped: Boolean(stopped), changedAt: new Date().toISOString(), changedBy: auth?.realProfile?.name || auth?.profile?.name || auth?.user?.email || "" };
  await writeSetting(CONTROL_SETTING_ID, control, auth?.realProfile?.id || auth?.profile?.id || null);
  return normalizeControl(control);
}

// Zip gerado do código (scripts/gerar-zips-extensoes.mjs). Na Vercel o arquivo entra pelo outputFileTracingIncludes.
export async function readExtensionZip(ext) {
  if (!isExtensionKey(ext)) throw new ExtensionInputError("Extensão desconhecida.", 404);
  const folder = EXTENSIONS[ext].folder;
  try {
    return { fileName: `${folder}-${LATEST_VERSIONS[ext]}.zip`, buffer: await readFile(path.join(process.cwd(), "ferramentas", `${folder}.zip`)) };
  } catch {
    throw new ExtensionInputError("O arquivo da extensão não foi encontrado no servidor.", 404);
  }
}
