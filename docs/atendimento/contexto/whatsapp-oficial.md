# Micro-pack: WhatsApp Oficial (antigo "WhatsApp Master")

Só conceito e fontes. Terminologia nova; renomear telas/código é fase futura.

- **O que é:** o conjunto de números oficiais (Cloud API da Meta) para **aquisição + tráfego patrocinado + pré-atendimento determinístico + automações + cadências + recuperação + reativação (30/60/90)**.
- **Escala planejada:** cerca de 6 linhas oficiais complementares. **Não substituem** os WhatsApps dos corretores, que continuam sendo o atendimento humano.
- **Configurável (valores são exemplos, nunca regra fixa):** distribuição entre números, limites diários por número, horários, base nova.
- **Interrupção obrigatória:** cliente responde, muda de estágio ou entra em "Não contactar" (ver `nao-contactar.md`).
- **Regras mutáveis da Meta** (templates, categorias, limites, qualidade, janela de 24h): vêm de documentação oficial atual, via executor web; nunca de memória.
- **Fontes no repositório (ler por Grep, não inteiro):** `docs/WHATSAPP.md`, `.claude/rules/integracoes-externas.md`, `lib/whatsapp-master.js`, `app/api/webhooks/whatsapp-master`.
