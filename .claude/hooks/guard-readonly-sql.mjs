// PreToolUse hook do agente analista-dados (mcp__Supabase__execute_sql):
// só deixa passar UMA instrução SELECT / WITH ... SELECT. Qualquer outra coisa
// (escrita, DDL, múltiplas instruções, função com efeito colateral) é NEGADA —
// sem opção de "ask". Falha fechada: se não conseguir ler a entrada, nega.
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let sql = "";
  try {
    sql = String(JSON.parse(raw || "{}")?.tool_input?.query || "");
  } catch {
    return deny("Não foi possível ler o SQL.");
  }

  const code = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .toLowerCase()
    .trim()
    .replace(/;\s*$/, "")
    .trim();

  if (!code) return deny("SQL vazio.");
  if (!/^(select|with)\b/.test(code)) return deny("Só SELECT / WITH ... SELECT é permitido.");
  if (code.includes(";")) return deny("Apenas uma instrução por chamada.");

  const forbidden = [
    [/\b(insert|update|delete|upsert|merge|truncate|drop|alter|create|grant|revoke|copy|call|vacuum|analyze|reindex|refresh|comment|lock|listen|notify|prepare|execute|begin|commit|rollback|savepoint|reset|discard)\b/, "comando de escrita/DDL/controle"],
    [/\bselect\b[\s\S]*\binto\b/, "SELECT INTO"],
    [/\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/, "FOR UPDATE/SHARE (trava linhas)"],
    [/\b(nextval|setval|set_config|lo_\w+|dblink\w*|txid_\w+)\s*\(/, "função com efeito colateral"],
    [/\bpg_(?!catalog\b|typeof\b|get_userbyid\b)\w+\s*\(/, "função pg_* administrativa"],
    [/\b(net|cron|vault|supabase_vault|storage|auth)\.\w+/, "esquema net/cron/vault/storage/auth"],
    [/\b(claim_\w+|whatsapp_get_or_create_\w+|daily_goal_\w+|set_daily_goal_\w+)\s*\(/, "RPC do CRM com efeito colateral"]
  ];
  const hits = forbidden.filter(([re]) => re.test(code)).map(([, label]) => label);
  if (hits.length) return deny(`Consulta bloqueada (${hits.join(", ")}). O analista-dados é somente leitura.`);
  process.exit(0);
});

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason }
  }));
  process.exit(0);
}
