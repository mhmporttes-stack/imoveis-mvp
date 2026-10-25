import { brazilianNational } from "../../utils/phone.js";

// Verificador PADRÃO de consentimento: lê (somente leitura, transação READ ONLY) o próprio CRM no mesmo Postgres.
// O campo enviado pelo CRM no pedido nunca é prova — só o que está gravado nas tabelas do CRM:
//   simulation_registrations (o cliente preencheu o formulário: origem/data; status do_not_contact/archived)
//   prospecting_contacts (status do_not_contact pelo telefone)
//   admin_users (ativos) + whatsapp_individual_sessions (telefones da equipe nunca recebem envio automático)
// Comparação de telefone = DDD + 8 últimos dígitos, o mesmo critério de phoneComparisonKey (lib/phone-utils.js do CRM).
//
// Finalidade: o CRM não tem campo de aceite/LGPD no formulário (conferido em 2026-10-25: só o link para a política de
// privacidade). O cadastro no formulário prova que o cliente pediu a simulação; por isso só as finalidades listadas
// em CONSENT_CRM_ACCEPTED_PURPOSES (padrão: retorno_simulacao) são aceitas. Qualquer outra é recusada.

const KEY_SQL = (col) => `(
  case when length(regexp_replace(coalesce(${col},''), '\\D', '', 'g')) > 11
            and regexp_replace(coalesce(${col},''), '\\D', '', 'g') like '55%'
       then left(substr(regexp_replace(${col}, '\\D', '', 'g'), 3), 2) || right(regexp_replace(${col}, '\\D', '', 'g'), 8)
       else left(regexp_replace(coalesce(${col},''), '\\D', '', 'g'), 2) || right(regexp_replace(coalesce(${col},''), '\\D', '', 'g'), 8)
  end)`;

export function comparisonKey(national) {
  const d = String(national || "").replace(/\D/g, "");
  return d.length >= 10 ? `${d.slice(0, 2)}${d.slice(-8)}` : "";
}

export function createCrmDbConsentVerifier({ pool, schema = "public", acceptedPurposes = ["retorno_simulacao"] }) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("CRM_DB_SCHEMA inválido.");
  const t = (name) => `"${schema}".${name}`;

  async function verify({ crmLeadId, phoneE164, purpose }) {
    const base = { verifier: "crm-db", origin: "crm_simulation_registrations", evidence_ref: null, consented_at: null };
    if (!pool) return { ...base, state: "unverifiable", reason: "crm_db_nao_configurado" };
    const national = brazilianNational(phoneE164);
    const key = comparisonKey(national);
    if (!key) return { ...base, state: "unverifiable", reason: "telefone_fora_do_brasil_sem_base_no_crm" };
    if (!/^[0-9a-f-]{36}$/i.test(String(crmLeadId))) return { ...base, state: "unverifiable", reason: "crm_lead_id_nao_e_um_cadastro_do_crm" };

    const client = await pool.connect();
    try {
      await client.query("begin transaction read only");
      const reg = await client.query(
        `select id, phone_normalized, status, created_at from ${t("simulation_registrations")} where id = $1`, [crmLeadId]
      );
      const row = reg.rows[0];
      const evidence = { ...base, evidence_ref: `simulation_registrations:${crmLeadId}`, consented_at: row?.created_at || null };
      if (!row) return { ...base, state: "denied", reason: "cadastro_inexistente_no_crm" };
      if (comparisonKey(row.phone_normalized) !== key) return { ...evidence, state: "denied", reason: "telefone_diferente_do_cadastro" };
      if (row.status === "do_not_contact") return { ...evidence, state: "revoked", reason: "nao_contactar_no_crm", suppress: true };

      const otherDnc = await client.query(
        `select 1 from ${t("simulation_registrations")} where status = 'do_not_contact' and ${KEY_SQL("phone_normalized")} = $1 limit 1`, [key]
      );
      if (otherDnc.rowCount) return { ...evidence, state: "revoked", reason: "nao_contactar_em_outro_cadastro_do_crm", suppress: true };
      const prospect = await client.query(
        `select 1 from ${t("prospecting_contacts")} where status = 'do_not_contact' and ${KEY_SQL("phone_normalized")} = $1 limit 1`, [key]
      );
      if (prospect.rowCount) return { ...evidence, state: "revoked", reason: "nao_contactar_na_prospeccao_do_crm", suppress: true };

      const team = await client.query(
        `select 1 from ${t("admin_users")} where status = 'active' and ${KEY_SQL("phone")} = $1
         union all
         select 1 from ${t("whatsapp_individual_sessions")} s
           where ${KEY_SQL("s.phone_number")} = $1
              or exists (select 1 from unnest(coalesce(s.known_phone_numbers, '{}'::text[])) k where ${KEY_SQL("k")} = $1)
         limit 1`,
        [key]
      );
      if (team.rowCount) return { ...evidence, state: "denied", reason: "telefone_da_equipe" };
      if (row.status === "archived") return { ...evidence, state: "denied", reason: "cliente_arquivado_no_crm" };
      if (!acceptedPurposes.includes(purpose)) return { ...evidence, state: "denied", reason: `finalidade_${purpose}_sem_consentimento_no_crm` };
      return { ...evidence, origin: "formulario_simulacao", state: "granted", reason: null };
    } catch (error) {
      // Falha de leitura (tabela ausente, permissão, rede) = NÃO autoriza.
      return { ...base, state: "unverifiable", reason: `erro_ao_consultar_crm:${String(error?.code || error?.message || "").slice(0, 60)}` };
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  }

  return { name: "crm-db", verify };
}
