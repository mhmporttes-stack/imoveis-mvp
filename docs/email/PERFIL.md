# PERFIL — dados canônicos do e-mail marketing

> Memória do agente `email-specialist` (Diretor de E-mail). Sem segredos, sem dados de cliente. Atualize quando um dado mudar. Criado em 2026-10-04.

## Identidade do remetente (marca)
| Campo | Valor | Fonte |
|---|---|---|
| Nome | Matheus Machado Imóveis · Matheus Machado, corretor de imóveis | `docs/posicionamento/PERFIL.md` |
| CRECI | 323106 | idem |
| Site / CTA | https://www.matheusmachadoimoveis.com.br/simulacao | produção |
| Política de privacidade | `/politica-de-privacidade` (existe no site) | `app/politica-de-privacidade` |
| Posicionamento | Especialista na compra do primeiro imóvel (MCMV, financiamento Caixa, Marília/SP) | idem |
| Visual | Azul + branco; âncoras em `.claude/skills/criar-email/references/marca-email.md` | `.claude/design/DESIGN.md` |

## Estado da infraestrutura de e-mail (2026-10-04)
| Item | Estado |
|---|---|
| E-mail transacional interno | Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`) — avisos ao dono/equipe |
| Provedor de marketing | **não definido** (decisão do dono) |
| Domínio/subdomínio remetente de marketing | **não definido** (recomendado: dedicado, separado do transacional) |
| SPF / DKIM / DMARC de marketing | **não configurados** |
| Descadastro, supressão, bounce/reclamação no CRM | **não existem** (→ `crm-editor`, depois da decisão do dono) |
| Origem/consentimento do e-mail em `prospecting_contacts` / `simulation_registrations.email` | **A CONFIRMAR** (via `analista-dados`) |
| Base legal LGPD para prospecção por e-mail | **A CONFIRMAR com advogado** |

## Oferta da 1ª campanha (rascunho do dono, 2026-10-04)
"Descubra seu poder de compra para o primeiro imóvel" → CTA para a simulação do site. Segmentação, cadência e volume: a definir em `/planejar-campanha-email`.

## Decisões abertas do dono
1. Provedor de envio e domínio remetente. 2. Base legal e texto de consentimento/descadastro. 3. Quem entra na primeira lista (origem). 4. Limite de contatos por pessoa/período. 5. Paleta definitiva (tokens do CRM × logo).
