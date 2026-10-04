<!--
PROVENIÊNCIA: lgpd-consent-schema (goul4rt, pt-BR; sem assets/)
Origem: https://github.com/goul4rt/lgpd-skills/blob/d85d79abeeb37cb99fc0785e735a9ca790698a77/skills/lgpd-consent-schema/SKILL.md
Repositório: goul4rt/lgpd-skills @ d85d79abeeb37cb99fc0785e735a9ca790698a77 | Licença: MIT (© 2026 goul4rt) (texto em docs/atendimento/especialistas/licencas/goul4rt-lgpd-skills-LICENSE.txt) | Baixado em 2026-10-03 | SHA256 do corpo: ab8492a8383e026d4d6851da264c3830a7c43175d0eb6c9fc2dfdb62c56fb827
VERBATIM — não editar; extensões ficam em compliance-lgpd.local.md. Este cabeçalho é só proveniência: o texto original abaixo não foi modificado.
Atualizar: refazer o download no novo SHA, comparar o diff com este arquivo e rever o .local.md.
Remover: apagar este arquivo (e a licença se ficar órfã) e a linha no INVENTARIO.md. Nada foi instalado nem executado; scripts/hooks/MCP do original não foram trazidos.
-->
---
name: lgpd-consent-schema
description: Design the database schema for a versioned, append-only consent ledger that satisfies LGPD Art. 8 (free, informed, unambiguous consent for a specific purpose) and Art. 9 (information rights). Use when user asks for "consent schema", "consent ledger", "schema de consentimento", "Prisma consentimento", "consent management", or is integrating consent capture with Better Auth, NextAuth, Clerk, or any auth library. Outputs a Prisma schema + integration spec. Also produces the structure needed to support DSAR revocation (Art. 18, IX).
---

# Consent Schema (Prisma + Better Auth)

Implementação técnica do consentimento como base legal (Art. 7º, I e Art. 11, I), versionado, auditável e revogável.

## Princípios

1. **Append-only** — nunca update destrutivo. Revogar = inserir novo registro com `status=REVOKED`.
2. **Versionado pela política** — todo consentimento aponta para uma versão específica do texto consentido.
3. **Específico por finalidade** — uma entrada por (titular, finalidade, versão da política).
4. **Evidência forte** — hash do payload (timestamp, IP, user-agent, UI snapshot).
5. **Revogação fácil** — Art. 8º, § 5º: "O consentimento pode ser revogado a qualquer momento mediante manifestação expressa do titular, por procedimento gratuito e facilitado."

## Schema Prisma de referência

Ver `assets/consent-schema.prisma`.

## Integração com Better Auth

Better Auth permite adicionar campos custom e hooks `beforeCreate`. Use para:

```ts
// auth.ts
export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  user: {
    additionalFields: {
      dateOfBirth: { type: "date", required: true }, // ECA Digital
      parentalConsentRef: { type: "string", required: false },
    }
  },
  hooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          // 1. Validar idade (ECA Digital se aplicável)
          // 2. Não criar registro de consentimento aqui — fazer em /api/consent/grant
          //    porque consentimento exige UX dedicada (não pode ser "enterrado" no signup)
          return user;
        }
      }
    }
  }
});
```

## Captura de consentimento na UI

Princípios:
- **Não pré-marcar** caixas (Art. 8º, § 4º — manifestação livre).
- **Granular por finalidade** — uma caixa por finalidade, não "concordo com tudo".
- **Linguagem clara** — leiga, sem juridiquês.
- **Link para política** — versão exata do texto consentido.
- **Idade** — se < 18, fluxo ECA Digital (ver `lgpd-eca-digital-minors`).

Exemplo de payload do endpoint `/api/consent/grant`:

```json
{
  "userId": "usr_abc123",
  "policyVersionId": "policy_v3.2",
  "purposes": [
    { "purpose": "marketing_email", "granted": true },
    { "purpose": "personalization", "granted": false },
    { "purpose": "analytics", "granted": true }
  ],
  "evidence": {
    "ip": "192.0.2.1",
    "userAgent": "...",
    "locale": "pt-BR",
    "channel": "web",
    "uiSnapshotHash": "sha256:..."
  }
}
```

## Revogação

Endpoint `/api/consent/revoke`:

```ts
async function revokeConsent(userId: string, purpose: string) {
  // 1. Cria registro com status=REVOKED, revokedAt=now
  await prisma.consentRecord.create({
    data: {
      subjectId: userId,
      purpose,
      status: "REVOKED",
      revokedAt: new Date(),
      // ... mesma policyVersionId do consentimento ativo
    }
  });

  // 2. Propaga para operadores (Datadog, Mixpanel, etc.)
  await propagateRevocation(userId, purpose);

  // 3. Bloqueia tratamentos futuros
  await blockFuturePurpose(userId, purpose);
}
```

## Helper de query

```ts
// Verificar se titular consentiu uma finalidade específica
export async function hasActiveConsent(
  subjectId: string,
  purpose: string
): Promise<boolean> {
  const latest = await prisma.consentRecord.findFirst({
    where: { subjectId, purpose },
    orderBy: { grantedAt: "desc" }
  });
  return latest?.status === "GRANTED";
}
```

**Sempre use este helper antes de tratar dados em finalidade baseada em consentimento.**

## Versionamento de política

Toda mudança material no texto da política de privacidade = nova `PolicyVersion`. Consentimentos antigos **não migram automaticamente** — você precisa re-coletar para a nova versão se a mudança afetar finalidades existentes (Art. 8º, § 6º).

## Audit log

Cada operação (grant, revoke, propagate) deve gerar entrada em `AuditLogEntry` (skill `lgpd-audit-logging`).

## Status update

```markdown
## F3 — Consent schema ✓
- Schema implementado em `prisma/schema.prisma`
- Endpoints: POST /api/consent/grant, POST /api/consent/revoke, GET /api/consent
- Better Auth hooks configurados
- Propagação para operadores: {lista}
- Próximo: lgpd-privacy-policy
```
