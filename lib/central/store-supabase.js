import "server-only";
import { getSupabaseAdminClient } from "../supabase";

// Implementacao do store da ponte sobre o Supabase (service role, so servidor).
// Toda transicao critica e uma funcao SQL atomica (supabase/migrations/20261003190000_central_tasks.sql).
export function createSupabaseCentralStore() {
  const db = () => {
    const client = getSupabaseAdminClient();
    if (!client) throw new Error("supabase indisponivel");
    return client;
  };
  const one = (data) => (Array.isArray(data) ? data[0] || null : data || null);
  const check = ({ data, error }) => {
    if (error) throw new Error("falha no banco");
    return one(data);
  };

  return {
    async create(row) {
      const { data, error } = await db().from("central_tasks").insert(row).select("*").single();
      if (!error) return { task: data, created: true };
      if (error.code === "23505" && row.idempotency_key) {
        const found = await db()
          .from("central_tasks").select("*")
          .eq("origem", row.origem).eq("idempotency_key", row.idempotency_key).single();
        if (found.data) return { task: found.data, created: false };
      }
      throw new Error("falha no banco");
    },
    async get(id) {
      return check(await db().from("central_tasks").select("*").eq("id", id).maybeSingle());
    },
    async claim(worker, leaseSeconds) {
      return check(await db().rpc("central_claim_task", { p_worker: worker, p_lease_seconds: leaseSeconds }));
    },
    async complete(id, worker, status, resultado, erro) {
      return check(await db().rpc("central_complete_task", {
        p_id: id, p_worker: worker, p_status: status, p_resultado: resultado, p_erro: erro
      }));
    },
    async renew(id, worker, leaseSeconds) {
      return check(await db().rpc("central_renew_lease", { p_id: id, p_worker: worker, p_lease_seconds: leaseSeconds }));
    },
    async requeueOwn(worker) {
      const { data, error } = await db().rpc("central_requeue_own", { p_worker: worker });
      if (error) throw new Error("falha no banco");
      return Number(data) || 0;
    },
    async decide(id, approve, by) {
      return check(await db().rpc("central_decide_task", { p_id: id, p_approve: approve, p_by: by }));
    },
    // Contagem no banco (serverless): falha fechado — sem checagem, nega.
    async rateLimit(key, windowSeconds, maxAttempts) {
      try {
        const { data, error } = await db().rpc("check_public_rate_limit", {
          p_key: key, p_window_seconds: windowSeconds, p_max_attempts: maxAttempts
        });
        if (error) return false;
        return data !== false;
      } catch {
        return false;
      }
    }
  };
}
