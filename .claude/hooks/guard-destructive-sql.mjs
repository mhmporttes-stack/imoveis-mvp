// PreToolUse hook — SQL do Supabase (execute_sql / apply_migration) de
// QUALQUER servidor Supabase: o estável `Supabase` do .mcp.json (somente
// leitura) e o conector da conta (no app de desktop aparece com um prefixo
// UUID). Usa só Node (roda no Windows do dono e no container Linux).
//
// Política (docs/PLANO_SUPABASE_MCP_ALIAS.md):
// 1. Agentes analíticos (READ_ONLY_AGENTS): banco SOMENTE LEITURA de verdade —
//    toda consulta roda dentro de `SET TRANSACTION READ ONLY` (o Postgres
//    recusa qualquer escrita, inclusive por função/RPC: erro 25006);
//    controle de transação e escrita explícita são negados antes; migration
//    é negada.
// 2. Sessão principal e demais agentes: leitura passa direto (lista "allow"
//    do settings); escrita/DDL pede confirmação; destrutivo pede confirmação
//    com o motivo em destaque.
// Falha fechada: se não conseguir ler a entrada, pede confirmação (e, para
// agente somente leitura, nega).

const READ_ONLY_AGENTS = new Set([
  "analista-dados",
  "auditor-crm",
  "gestor-trafego",
  "gestor-financeiro",
  "marketing-posicionamento"
]);

const DESTRUCTIVE = [
  [/\bdrop\b/, "DROP"],
  [/\btruncate\b/, "TRUNCATE"],
  [/\bdelete\s+from\b/, "DELETE"],
  [/\bupdate\s+[\w."]+\s+set\b(?![\s\S]*\bwhere\b)/, "UPDATE sem WHERE"],
  [/\balter\s+(role|user)\b|\bcreate\s+(role|user)\b|\bpassword\b/, "papéis/senhas"],
  [/\bgrant\b|\brevoke\b/, "GRANT/REVOKE (permissões)"],
  [/\bdisable\s+row\s+level\s+security\b|\bno\s+force\s+row\s+level\b|\benable\s+row\s+level\s+security\b/, "RLS"],
  [/\b(create|alter|drop)\s+policy\b/, "policy de RLS"],
  [/\b(insert|update|delete)\b[\s\S]*\b(auth|vault|storage|cron)\./, "esquemas auth/vault/storage/cron"],
  [/\bvault\.|\bdecrypted_secrets\b|\bsecret/, "secrets/credenciais"],
  [/\bcron\.(schedule|unschedule|alter_job)\b/, "agendamento pg_cron"],
  [/\bsecurity\s+definer\b/, "função SECURITY DEFINER"]
];

const WRITE = /\b(insert|update|delete|merge|upsert|create|alter|drop|truncate|grant|revoke|copy|vacuum|analyze|reindex|cluster|refresh|comment\s+on|security\s+label|lock|call|do|import|load|notify|listen|prepare|execute|discard|reset|set|select\s[\s\S]*\binto\b)\b/;
// "END" só como comando (CASE ... END é leitura normal).
const TX_CONTROL = /\b(begin|commit|rollback|abort|savepoint|release|start\s+transaction)\b|(^|;)\s*end\s*(;|$)/;

let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    return decide("ask", "Não foi possível ler o SQL — confirmação necessária.");
  }
  const toolName = String(input?.tool_name || "");
  const agent = String(input?.agent_type || "");
  const readOnlyAgent = READ_ONLY_AGENTS.has(agent);
  const isMigration = /__apply_migration$/.test(toolName);
  const sql = String(input?.tool_input?.query || "");
  const code = normalize(sql);

  if (readOnlyAgent) {
    if (isMigration) return decide("deny", `O agente ${agent} é somente leitura: migration não é permitida.`);
    if (!code.trim()) return decide("deny", "SQL vazio.");
    if (TX_CONTROL.test(code)) return decide("deny", `O agente ${agent} é somente leitura: controle de transação (BEGIN/COMMIT/…) não é permitido.`);
    if (WRITE.test(code)) return decide("deny", `O agente ${agent} é somente leitura: o SQL contém escrita/DDL/SET. Use apenas SELECT/WITH/EXPLAIN.`);
    // Qualquer escrita escondida (ex.: função que grava) é recusada pelo
    // próprio Postgres: a consulta inteira roda numa transação read-only.
    return decide("allow", `Agente ${agent}: consulta em transação somente leitura.`, {
      ...input.tool_input,
      query: `set transaction read only;\n${sql}`
    });
  }

  const hits = DESTRUCTIVE.filter(([pattern]) => pattern.test(code)).map(([, label]) => label);
  if (hits.length) return decide("ask", `SQL de alto risco (${hits.join(", ")}) — exige autorização do dono.`);
  if (isMigration) return decide("ask", "Migration (altera o schema de produção) — confirme.");
  if (WRITE.test(code) || TX_CONTROL.test(code)) return decide("ask", "SQL com escrita no banco de produção — confirme.");
  process.exit(0);
});

// Tira comentários e literais (texto "drop" num comentário/string não é DROP).
function normalize(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, " $$ ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, "\"\"")
    .toLowerCase();
}

function decide(permissionDecision, permissionDecisionReason, updatedInput) {
  const hookSpecificOutput = { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason };
  if (updatedInput) hookSpecificOutput.updatedInput = updatedInput;
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
  process.exit(0);
}
