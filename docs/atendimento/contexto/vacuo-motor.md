# Micro-pack: motor de vácuo

Modelo (PROTOCOLO §7): evento → contexto → condições → etapa do funil → comportamento → origem → horário provável → regras do WhatsApp → histórico → tentativa atual → ação → espera → nova condição → continuação ou encerramento.

- **Campos:** última mensagem do cliente e a última enviada (data e hora), etapa, responsável, origem, campanha, número oficial, tentativas anteriores e o que diziam, automação atual, próxima ação.
- **Horário provável:** sinal probabilístico a partir de horários e dias históricos de resposta e do intervalo médio de resposta; nunca certeza. Dados via `analista-dados`.
- **Condições de saída (sempre):** cliente respondeu, mudou de etapa, entrou em Não contactar (`nao-contactar.md`), foi vendido ou arquivado, mudou de responsável.
- **Regras do canal:** janela de atendimento e modelos do número oficial vêm da documentação oficial atual (`whatsapp-oficial-meta`, executor web).
- **Parar é válido:** limite de tentativas e intervalos são configuráveis (valores de exemplo não são regra); depois do limite, encerrar com gentileza ou agendar reativação futura (`reativacao-30-60-90`).
- Envio automático passa por `auditor-automacoes` antes de qualquer proposta.
