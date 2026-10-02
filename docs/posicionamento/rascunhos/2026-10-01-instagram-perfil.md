# Rascunho — correção do perfil do Instagram (BACKLOG item 1)

> Status: **PROPOSTA, NADA APLICADO.** Aguardando aprovação do dono. Fonte do "atual": Windsor/Instagram, 2026-10-01.

## ATUAL
- Nome: `Matheus Machado | Corretor de imóveis`
- Bio (151 caracteres):
  ```
  📈 Especialista em financiamento imobiliário
  🔑 Quer comprar ou vender um imóvel? Fale comigo
  💙 Crédito aprovado em até 1 hora
  👇🏻Faça sua simulação
  ```
- Link: `https://imoveis-mvp.vercel.app/`

## PROPOSTA
- Nome (41 caracteres): `Matheus Machado | Primeiro Imóvel Marília`
- Bio (139 caracteres):
  ```
  🏠 Especialista na compra do primeiro imóvel
  📍 Marília/SP · Minha Casa Minha Vida · Financiamento Caixa
  CRECI 323106
  👇 Simule sua entrada
  ```
- Link: `https://www.matheusmachadoimoveis.com.br/simulacao?utm_source=instagram&utm_medium=organic&utm_campaign=bio_instagram`

## Pontos a confirmar antes de aplicar
- Formato do CRECI (o site usa "CRECI 323106"; confirmar se deve levar UF e sufixo, ex.: CRECI-SP 323106-F).
- Categoria do perfil profissional (campo separado do nome) permanece "Corretor de imóveis"/equivalente.
- O CRM classifica o link como origem "Link — bio_instagram" (`lib/lead-origin.js`: `utm_source` presente e `utm_medium` fora do padrão pago). Conferir no próximo lead real vindo da bio; não gravar lead de teste em produção.
