// PreToolUse hook (Supabase MCP execute_sql / apply_migration): consultas e
// migrations rotineiras passam direto; SQL destrutivo ou de alto risco volta
// a pedir autorização do dono. Usa só Node (roda no Windows do dono e no
// container Linux). Falha aberta para "ask": se não conseguir ler a entrada,
// pede confirmação em vez de liberar.
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let sql = "";
  try {
    const input = JSON.parse(raw || "{}");
    sql = String(input?.tool_input?.query || "");
  } catch {
    return ask("Não foi possível ler o SQL — confirmação necessária.");
  }

  // Remove comentários e literais de string antes de procurar palavras-chave
  // (um texto "drop" dentro de um comentário não é um DROP).
  const code = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .toLowerCase();

  const rules = [
    [/\bdrop\b/, "DROP"],
    [/\btruncate\b/, "TRUNCATE"],
    [/\bdelete\s+from\b/, "DELETE"],
    [/\bupdate\s+[\w."]+\s+set\b(?![\s\S]*\bwhere\b)/, "UPDATE sem WHERE"],
    [/\balter\s+(role|user)\b|\bcreate\s+(role|user)\b|\bpassword\b/, "papéis/senhas"],
    [/\bgrant\b[\s\S]*\bto\s+(anon|authenticated|public)\b/, "GRANT para anon/authenticated/public"],
    [/\bdisable\s+row\s+level\s+security\b|\bno\s+force\s+row\s+level\b/, "desligar RLS"],
    [/\bcreate\s+policy\b|\balter\s+policy\b/, "policy de RLS"],
    [/\b(insert|update|delete)\b[\s\S]*\b(auth|vault|storage|cron)\./, "esquemas auth/vault/storage/cron"],
    [/\bcron\.(schedule|unschedule|alter_job)\b/, "agendamento pg_cron"],
    [/\b(security\s+definer)\b/, "função SECURITY DEFINER"]
  ];
  const hits = rules.filter(([pattern]) => pattern.test(code)).map(([, label]) => label);
  if (hits.length) return ask(`SQL de alto risco (${hits.join(", ")}) — exige autorização do dono.`);
  process.exit(0);
});

function ask(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason }
  }));
  process.exit(0);
}
