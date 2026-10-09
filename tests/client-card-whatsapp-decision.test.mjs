import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideCardWhatsapp, detectDevice, buildExternalWhatsappUrl } from "../lib/client-card-whatsapp-core.mjs";

// REGRA OFICIAL (dono, 2026-10-02): destino do botão WhatsApp pelo estado REAL da sessão.
const base = { stateKnown: true, isOwnClient: true, clientStatus: "in_service", phone: "(14) 99765-4321" };
const WEB = "https://web.whatsapp.com/send?phone=5514997654321";
const APP = "https://wa.me/5514997654321";

test("tabela estado x dispositivo", () => {
  const rows = [
    // sessionStatus, restricted, device, action, url
    ["connected", false, "desktop", "chat"], ["connected", false, "mobile", "chat"],
    ["connected", true, "mobile", "chat"], // restrição só vale sem sessão conectada
    ["disconnected", false, "desktop", "external", WEB], ["disconnected", false, "mobile", "external", APP],
    [null, false, "desktop", "external", WEB], ["failed", false, "mobile", "external", APP],
    ["qr_required", false, "desktop", "external", WEB], ["error", false, "desktop", "external", WEB],
    ["reconnecting", false, "desktop", "chat"], ["stored", false, "mobile", "chat"], ["connecting", false, "mobile", "chat"],
    ["reconnecting", true, "desktop", "external", WEB], // restrição informada/validada abre fora
    ["disconnected", true, "mobile", "external", APP]
  ];
  for (const [sessionStatus, restricted, device, action, url] of rows) {
    const r = decideCardWhatsapp({ ...base, sessionStatus, restricted, device });
    assert.equal(r.action, action, `${sessionStatus}/${restricted}/${device}`);
    if (url) assert.equal(r.url, url);
  }
});

test("estado desconhecido/carregando, cliente arquivado/Não contactar, cliente de outro e telefone inválido: sempre Chat", () => {
  const down = { ...base, sessionStatus: "disconnected", device: "desktop" };
  assert.equal(decideCardWhatsapp({ ...down, stateKnown: false }).action, "chat");
  assert.equal(decideCardWhatsapp({ ...down, clientStatus: "archived" }).action, "chat");
  assert.equal(decideCardWhatsapp({ ...down, clientStatus: "do_not_contact" }).action, "chat");
  assert.equal(decideCardWhatsapp({ ...down, isOwnClient: false }).action, "chat");
  assert.equal(decideCardWhatsapp({ ...down, phone: "123" }).action, "chat");
  assert.equal(decideCardWhatsapp({}).action, "chat");
});

test("dispositivo só escolhe o link, nunca o destino (incidente do PWA 04a9288)", () => {
  assert.equal(detectDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome" }), "desktop");
  assert.equal(detectDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile" }), "mobile");
  assert.equal(detectDevice({ userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 5 }), "mobile");
  assert.equal(detectDevice({ userAgent: "Windows", standalone: true }), "mobile");
  assert.equal(decideCardWhatsapp({ ...base, sessionStatus: "connected", device: "mobile" }).action, "chat");
  assert.equal(buildExternalWhatsappUrl("", "desktop"), "");
});

test("núcleo não toca em status/elegibilidade e a rota é só leitura", () => {
  const core = readFileSync(new URL("../lib/client-card-whatsapp-core.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(core, /supabase|from\("/);
  const route = readFileSync(new URL("../app/api/admin/whatsapp-individual/card-state/route.js", import.meta.url), "utf8");
  assert.match(route, /requireAdminApi/);
  assert.doesNotMatch(route, /endRestrictionIfConnected|\.update\(|\.insert\(|export async function (POST|PUT|PATCH|DELETE)/);
});

test("Chat híbrido (envio pessoal desligado) não tira o card do Chat; só o Chat todo desligado (2026-10-09)", () => {
  const route = readFileSync(new URL("../app/api/admin/whatsapp-individual/card-state/route.js", import.meta.url), "utf8");
  assert.match(route, /isChatDisabled\(\)\]\);/);
  assert.doesNotMatch(route, /isIndividualChatSendDisabled/);
});
