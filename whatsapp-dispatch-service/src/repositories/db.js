import pg from "pg";

// Pool do Postgres. Todas as tabelas do serviço ficam no schema wa_dispatch (nomes sempre qualificados).
export function createDb({ url, ssl = false, max = 10, applicationName = "whatsapp-dispatch-service" }) {
  if (!url) throw new Error("DATABASE_URL não configurada.");
  const pool = new pg.Pool({
    connectionString: url,
    max,
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
    application_name: applicationName,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000
  });
  pool.on("error", () => {}); // erro de conexão ociosa: o próximo query reporta; não derruba o processo.

  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    pool,
    query: (text, params) => pool.query(text, params),
    tx,
    close: () => pool.end()
  };
}
