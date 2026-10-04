# Entregabilidade e conformidade — fatos e checklist

Fatos externos **[VERIFICADO 2026-10-04]** pelo `agent-scout` nas fontes oficiais (relatório `docs/scout/relatorios/2026-10-04-email-marketing-diretor-email.md`); regras de provedor mudam — reconfirme antes de decidir.

## Exigências de remetentes (Gmail / Yahoo)
- Gmail ([support.google.com/a/answer/81126](https://support.google.com/a/answer/81126)): SPF **ou** DKIM para todo remetente; **SPF + DKIM + DMARC com alinhamento** para quem envia > 5.000 msg/dia ao Gmail; taxa de spam reportada ideal **< 0,10%** e nunca ≥ **0,30%**; marketing em escala com **one-click unsubscribe** (RFC 8058); TLS; DNS reverso/PTR válido. Vigente desde 1/2/2024.
- Yahoo ([senders.yahooinc.com/best-practices](https://senders.yahooinc.com/best-practices/)): SPF e DKIM; DMARC no mínimo `p=none`; spam < 0,3%; descadastro atendido em até 2 dias.
- RFC 8058: cabeçalhos `List-Unsubscribe: <https://…>, <mailto:…>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; URI HTTPS não forjável (token por destinatário); os dois cabeçalhos cobertos por DKIM. Provedores de envio geralmente implementam isto — exigir no escolhido.
- Mesmo abaixo de 5.000/dia: autenticar e ter descadastro fácil (reputação e Outlook/Microsoft aplicam critérios próprios — **A CONFIRMAR** exigências atuais da Microsoft).

## Checklist go/no-go
**Domínio e autenticação**
1. Domínio/subdomínio remetente **de marketing** definido (decisão do dono; separado do transacional e do domínio institucional principal). **[PENDENTE]**
2. SPF com `include` do provedor, ≤ 10 lookups, `-all` ou `~all` conforme maturidade.
3. DKIM ativo (chave ≥ 2048 bits quando suportado), seletor do provedor; alinhamento com o `From`.
4. DMARC publicado: começar `p=none` com `rua` para relatórios, evoluir para `quarantine`/`reject` após análise; alinhamento SPF/DKIM.
5. PTR/rDNS e TLS fornecidos pelo provedor; link/tracking domain próprio (CNAME) quando oferecido.
**Lista e consentimento**
6. Origem de cada contato registrada; sem lista comprada/raspada; base legal LGPD definida e **validada por advogado** antes de envio em massa (ANPD: legítimo interesse exige teste em 3 etapas — finalidade, necessidade, balanceamento — e opt-out fácil; prospecção ativa tem escrutínio maior; [guia ANPD](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-lanca-guia-orientativo-sobre-legitimo-interesse) — **ler o PDF original**: o scout só viu resumo).
7. Higiene: validar sintaxe e remover duplicados, role accounts (`info@`, etc.), endereços inválidos; nunca reenviar a bounce duro.
8. Supressão global: descadastro, reclamação, bounce duro, `do_not_contact`, clientes que pediram para parar por outro canal (**checagem no servidor**).
**Mensagem**
9. Remetente identificável (nome + domínio coerente), assunto honesto, rodapé com identificação, CRECI, motivo do recebimento, descadastro de 1 clique.
10. HTML leve (< 102 KB), versão texto, razão texto/imagem equilibrada, links https diretos sem encurtador de terceiros, domínio de tracking coerente, sem anexo.
11. Conformidade imobiliária (`conformidade-imobiliaria.md`).
**Operação**
12. Webhooks/relatórios de bounce, reclamação e descadastro chegam ao CRM e alimentam a supressão. **[NÃO EXISTE hoje]**
13. Rampa de volume gradual (lote pequeno → crescente, só se bounce/reclamação saudáveis); frequência por pessoa limitada; pausa automática se limite de reclamação for atingido.
14. Monitoramento: Google Postmaster Tools / painel Yahoo / relatórios DMARC; lista de verificação semanal (`/analisar-campanha-email`).
15. Teste de envio **só** para endereços do dono, com aprovação explícita; conferir cabeçalhos (SPF/DKIM/DMARC = pass) e renderização em Gmail, Outlook, Apple Mail.

## Diagnóstico — sintomas comuns
Cai em spam: autenticação sem alinhamento > lista fria/origem fraca > conteúdo/links > volume brusco > reputação do domínio novo. Bounce alto: lista suja. Reclamação alta: expectativa errada, frequência, descadastro difícil. Abertura baixa sozinha não é diagnóstico (proteção de privacidade da Apple distorce).

## Proibido (evasão)
Ofuscar palavras, texto invisível para enganar filtro, rotação de domínios/IPs para fugir de bloqueio, "aquecimento" artificial, encurtadores de terceiros, remover descadastro, falsificar remetente/cabeçalhos, reativar quem reclamou.
