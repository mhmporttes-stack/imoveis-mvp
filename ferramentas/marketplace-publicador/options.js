import { DEFAULT_CRM_URL, normalizeBaseUrl } from "./lib/crm-api.js";

const $ = (id) => document.getElementById(id);

async function load() {
  const { config } = await chrome.storage.local.get("config");
  $("baseUrl").value = config?.baseUrl || DEFAULT_CRM_URL;
  $("key").placeholder = config?.key ? "Chave salva (••••)" : "mkp_...";
  $("prints").checked = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  const { keepAwake } = await chrome.storage.local.get("keepAwake");
  $("keepAwake").checked = keepAwake !== false; // ligado por padrão
}

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const msg = $("msg");
  try {
    const baseUrl = normalizeBaseUrl($("baseUrl").value);
    const typedKey = $("key").value.trim();
    if (typedKey && !typedKey.startsWith("mkp_")) throw new Error("A chave começa com mkp_. Gere uma no CRM.");
    if (baseUrl !== DEFAULT_CRM_URL) {
      const granted = await chrome.permissions.request({ origins: [`${baseUrl}/*`] });
      if (!granted) throw new Error("Sem permissão para acessar esse endereço.");
    }
    if ($("prints").checked) await chrome.permissions.request({ origins: ["<all_urls>"] });
    else await chrome.permissions.remove({ origins: ["<all_urls>"] }).catch((error) => chrome.runtime.sendMessage({ type: "mp-swallowed", context: "tirar a permissão de prints", error: String(error?.message || error) }));
    const { config } = await chrome.storage.local.get("config");
    await chrome.storage.local.set({ config: { baseUrl, key: typedKey || config?.key || "" }, keepAwake: $("keepAwake").checked });
    $("key").value = "";
    msg.textContent = "Salvo.";
    await load();
  } catch (error) {
    msg.textContent = error.message;
  }
});

load();
