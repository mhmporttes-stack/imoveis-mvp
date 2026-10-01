# Conformidade de anúncios — imobiliário, MCMV e financiamento

Vale para `/criar-anuncio` e `/planejar-campanha`. Na dúvida, corte a frase.

## Proibido

- Prometer aprovação ("aprovação garantida", "sem consulta", "nome sujo aprova", "100% aprovado").
- Prometer valor de subsídio, parcela ou taxa sem fonte. Número só se vier do motor de simulação (`lib/simulacao-entrada/*`) ou da regra cadastrada do empreendimento, com o contexto ("a partir de", "conforme renda e análise").
- Usar marca/logo da Caixa ou do programa como se o anúncio fosse oficial do governo/banco. Pode citar "Minha Casa Minha Vida" como programa e "correspondente Caixa" se for verdade.
- Atributos pessoais na copy dirigidos ao leitor ("Você está endividado?", "Você ganha pouco?") — a Meta reprova anúncios que afirmam/insinuam características pessoais. Prefira "Para quem quer sair do aluguel".
- Depoimento, número de clientes, prêmio ou parceria que não dê para comprovar.
- Dado pessoal de cliente real (nome, foto, renda) sem autorização expressa.
- Urgência falsa ("últimas unidades" sem ser verdade).

## Obrigatório quando aplicável

- Financiamento/subsídio: "sujeito a análise de crédito" (ou equivalente) no texto ou na imagem.
- Valores: "a partir de" + condição ("conforme renda", "na planta", data de referência quando fizer sentido).
- Imagem: foto real do empreendimento/da região; ilustração identificada como ilustração.
- Identificação da imobiliária/corretor responsável (CRECI quando exigido pelo material).

## Categoria especial da Meta (moradia / crédito)

**A CONFIRMAR.** Não sabemos se a conta declara campanhas como categoria especial (a sincronização não traz `special_ad_categories`). Categoria especial limita segmentação (idade, gênero, raio, interesses). Até o dono confirmar: não presuma nem recomende segmentação "permitida" ou "proibida" com base nisso; ao criar a especificação, deixe o campo "categoria especial" como decisão do dono no momento da criação.

## Dados e privacidade

- Nunca usar renda exata, CPF ou telefone de cliente para público/evento. O evento de conversão já envia só faixa de renda e telefone com hash (`docs/TRAFEGO_META.md` §3).
