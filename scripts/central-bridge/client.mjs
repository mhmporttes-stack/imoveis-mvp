// Cliente HTTP do executor: so conexoes de SAIDA para /api/central/executor/*.
export function createHttpClient({ baseUrl, secret, workerId, fetchImpl = fetch }) {
  async function call(method, path, body) {
    const res = await fetchImpl(`${baseUrl}/api/central/${path}`, {
      method,
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      // corpo nao-JSON
    }
    return { status: res.status, json };
  }
  const must = (r, what) => {
    if (r.status >= 200 && r.status < 300) return r.json;
    const err = new Error(`${what}: HTTP ${r.status}${r.json?.error?.code ? ` (${r.json.error.code})` : ""}`);
    err.status = r.status;
    throw err;
  };
  return {
    async claim() {
      return must(await call("POST", "executor/claim", { worker_id: workerId }), "claim").task;
    },
    async complete(id, body) {
      const r = await call("POST", `executor/tasks/${id}/result`, { worker_id: workerId, ...body });
      if (r.status === 409) return null; // lease perdido: outro executor assumiu
      return must(r, "result");
    },
    async renew(id) {
      const r = await call("POST", `executor/tasks/${id}/heartbeat`, { worker_id: workerId });
      return r.status === 200;
    },
    async requeue() {
      return must(await call("POST", "executor/requeue", { worker_id: workerId }), "requeue").requeued;
    }
  };
}
