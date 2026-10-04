// Chamadas da gestão da Academia (navegador -> rotas /api/admin/academia). Nada de Supabase aqui.
const BASE = "/api/admin/academia";

async function request(path, init) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    throw Object.assign(new Error("Sem conexão. Tente de novo."), { code: "network" });
  }
  let json = null;
  try { json = await res.json(); } catch { /* corpo vazio */ }
  if (!res.ok) throw Object.assign(new Error(json?.error || "Não foi possível concluir."), { code: json?.code || "error", extra: json?.extra || {} });
  return json;
}

export const listTracks = () => request("/content");
export const getVersion = (id) => request(`/content/versions/${id}`);
export const act = (action, input = {}) => request("/content", { method: "POST", body: JSON.stringify({ action, ...input }) });
export const listGrants = () => request("/grants");
export const grantExtra = (enrollmentId, examId, reason) => request("/grants", { method: "POST", body: JSON.stringify({ enrollmentId, examId, ...(reason ? { reason } : {}) }) });
