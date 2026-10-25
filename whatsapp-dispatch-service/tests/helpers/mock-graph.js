// MOCK da Graph API (WhatsApp Cloud API) — SÓ PARA TESTES. Nada sai da máquina: o adaptador real recebe este
// fetch falso no lugar do fetch global. Nenhuma resposta daqui representa a Meta de verdade.
export function createMockGraphFetch({ phones = {}, profile = {} } = {}) {
  const calls = [];
  const sendPlan = []; // fila de comportamentos para POST /messages
  let counter = 0;
  const state = { profile: { about: "", address: "", description: "", email: "", websites: [], vertical: "", profile_picture_url: "", ...profile } };

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const graphError = (status, code, message = "erro simulado") => json(status, { error: { code, message, type: "OAuthException" } });

  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method || "GET").toUpperCase();
    calls.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: init.body && typeof init.body === "string" ? JSON.parse(init.body) : init.body ? "<binary>" : null, headers: init.headers || {} });
    if (url.hostname === "images.mock.invalid") {
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    const parts = url.pathname.split("/").filter(Boolean); // [version, ...]
    const [, first, second] = parts;
    if (method === "GET" && phones[first] && !second) {
      const p = phones[first];
      if (p.error) return graphError(p.error.status || 400, p.error.code);
      return json(200, { id: first, display_phone_number: p.display, verified_name: p.verifiedName || "Nome Teste", quality_rating: p.quality || "GREEN", status: p.status || "CONNECTED", name_status: "APPROVED", code_verification_status: "VERIFIED" });
    }
    if (second === "messages" && method === "POST") {
      const step = sendPlan.shift() || { type: "ok" };
      if (step.type === "ok") { counter += 1; return json(200, { messaging_product: "whatsapp", contacts: [{ input: "x", wa_id: "x" }], messages: [{ id: `wamid.MOCK${counter}`, message_status: "accepted" }] }); }
      if (step.type === "graph_error") return graphError(step.status || 400, step.code);
      if (step.type === "http_500_empty") return new Response("", { status: 500 });
      if (step.type === "timeout") { const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; throw e; }
      if (step.type === "refused") { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; }
    }
    if (second === "whatsapp_business_profile") {
      if (method === "GET") return json(200, { data: [{ ...state.profile, messaging_product: "whatsapp" }] });
      const body = JSON.parse(init.body);
      const { messaging_product, profile_picture_handle, ...fields } = body;
      Object.assign(state.profile, fields);
      if (profile_picture_handle) state.profile.profile_picture_url = "https://pps.mock.invalid/foto.jpg";
      return json(200, { success: true });
    }
    if (second === "uploads" && method === "POST") return json(200, { id: "upload:MOCKSESSION" });
    if (first === "upload:MOCKSESSION" && method === "POST") return json(200, { h: "2:MOCKHANDLE" });
    return graphError(400, 100, `rota não simulada: ${method} ${url.pathname}`);
  }

  return {
    fetchImpl,
    calls,
    state,
    planSend: (...steps) => sendPlan.push(...steps),
    sendCalls: () => calls.filter((c) => c.method === "POST" && c.path.endsWith("/messages"))
  };
}
