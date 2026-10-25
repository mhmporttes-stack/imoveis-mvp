import { z } from "zod";

// Verificador alternativo: pergunta a um endpoint do CRM (CRM_CONSENT_VERIFY_URL, Bearer CRM_CONSENT_VERIFY_TOKEN).
// O CRM ainda NÃO expõe esse endpoint (pendência). Contrato esperado (POST JSON):
//   pedido:   { crm_lead_id, phone_e164, purpose }
//   resposta: { state: "granted"|"denied"|"revoked", origin, evidence_ref, consented_at, reason?, do_not_contact? }
// Sem configuração, resposta inválida, erro ou tempo esgotado → "unverifiable" (lead recusado).
const responseSchema = z.object({
  state: z.enum(["granted", "denied", "revoked"]),
  origin: z.string().min(1).max(100),
  evidence_ref: z.string().min(1).max(200),
  consented_at: z.string().datetime({ offset: true }).nullable().optional(),
  reason: z.string().max(200).nullable().optional(),
  do_not_contact: z.boolean().optional()
});

export function createCrmHttpConsentVerifier({ url, token, timeoutMs = 5000, fetchImpl = globalThis.fetch }) {
  async function verify({ crmLeadId, phoneE164, purpose }) {
    const base = { verifier: "crm-http", origin: "crm_http", evidence_ref: null, consented_at: null };
    if (!url || !token) return { ...base, state: "unverifiable", reason: "CRM_CONSENT_VERIFY_URL/TOKEN não configurados" };
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ crm_lead_id: crmLeadId, phone_e164: phoneE164, purpose }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) return { ...base, state: "unverifiable", reason: `crm_http_${response.status}` };
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) return { ...base, state: "unverifiable", reason: "resposta_do_crm_invalida" };
      const r = parsed.data;
      return {
        ...base, state: r.state, origin: r.origin, evidence_ref: r.evidence_ref, consented_at: r.consented_at || null,
        reason: r.reason || null, suppress: r.state === "revoked" || r.do_not_contact === true
      };
    } catch (error) {
      return { ...base, state: "unverifiable", reason: `crm_http_indisponivel:${error?.name || "erro"}` };
    }
  }
  return { name: "crm-http", verify };
}
