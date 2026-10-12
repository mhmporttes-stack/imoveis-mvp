# Brief — Mesa de Criação: robô do Chat que faz o cliente preencher o formulário (2026-10-12)

- **Ideia do dono:** melhorar o atendimento automático do Chat do WhatsApp — o robô inteiro (Fluxos, menu, respostas por palavra-chave, pós-formulário, lembretes) para todo contato que chega (anúncio, orgânico, disparo). Quer ver a ideia ANTES de implementar.
- **Dor principal (dono):** o cliente recebe o link e **não preenche o formulário** de simulação (`/s`).
- **Objetivo de negócio:** subir a % de conversas que viram formulário preenchido (cadastro + corretor + simulação), sem soar robótico e sem atrasar o cliente quente.
- **Público:** comprador do 1º imóvel em Marília/SP, MCMV, renda baixa ou informal, medo de "nome sujo", vergonha, pouca familiaridade com formulário.
- **Canal:** WhatsApp (Oficial + individual por corretor) → formulário `/s` do site.
- **Como funciona hoje:** `docs/WHATSAPP.md` §8 (Fluxos), §9 (palavra-chave), §9-A (pós-formulário), §9-B (lead do anúncio, WA-18: fica com o dono em "Atendimento automático" até responder/preencher), §9-C (lembretes WA-17: anúncio 1h/3h/10h/23h; demais 1 lembrete). Modelos: `components/flows/flow-templates.js`. Dados: `whatsapp_flows`, `whatsapp_flow_sessions`, `whatsapp_flow_logs`, `whatsapp_messages`, `whatsapp_automation_replies`, `simulation_registrations`.
- **Restrições:** regras WA-* de `docs/BUSINESS_RULES.md`; janela de 24 h/modelos do Oficial; limites do Fluxo (botões ≤ 3, lista ≤ 10, 8 envios/execução, espera ≤ 23 h); `do_not_contact` nunca recebe automático; nada é enviado/publicado/alterado — sai como **Especificação** para o `crm-editor`, implementada só com "sim" do dono.
