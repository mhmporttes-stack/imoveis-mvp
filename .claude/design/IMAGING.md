# IMAGING — direção de arte, geração e edição de imagem

Carregar para: especificar/gerar/editar imagem, banner, hero, ativo para peça, fundo, ilustração, imagem de campanha. Para foto de imóvel carregue também `PHOTOGRAPHY.md`. Metodologia, **não** acoplamento a um serviço: não contrate API, não instale ferramenta de terceiros, não suba imagem do cliente para serviço externo sem aprovação do dono.

## 1. Direção de arte (decidir a imagem que a composição precisa)

Não receba imagem pronta e a encaixe: **especifique a imagem**. Decida:
- **Função:** o que a imagem faz na peça (ancorar emoção, provar o imóvel, dar escala, preencher fundo de texto)?
- **Ponto focal** e **espaço negativo** reservado para texto/CTA (onde o texto entra e com que contraste).
- **Enquadramento e proporção** (e como corta em 1:1, 4:5, 16:9, 9:16 — o assunto sobrevive aos cortes?).
- **Clima e luz** (hora, temperatura de cor, contraste), **paleta** (relação com o azul da marca; evite brigar com ela), **textura**, **relação imagem/texto**, **consistência** com as outras peças da série.
- **Autenticidade:** gente e lugar plausíveis para Marília/SP e para o público de 1º imóvel; evite o "banco de imagem genérico".

## 2. Briefing de imagem (antes de gerar ou contratar)

`OBJETIVO → FORMATO → COMPOSIÇÃO → ASSUNTO → PERSPECTIVA → ILUMINAÇÃO → ESTILO → RESTRIÇÕES → OUTPUT`
- **Objetivo:** onde e para quê será usada. **Formato:** proporção, resolução, fundo transparente?
- **Composição:** posição do foco, espaço negativo, linhas-guia, camadas (primeiro plano/meio/fundo).
- **Assunto:** o que aparece, com detalhes verificáveis (material, época, estado).
- **Perspectiva:** altura da câmera, ângulo, distância focal aparente (só quando contribui — `PHOTOGRAPHY.md`).
- **Iluminação:** fonte, direção, qualidade (dura/macia), temperatura de cor.
- **Estilo:** fotográfico, editorial, ilustração, flat/vetorial; referência de **princípio** (nunca de marca ou artista específico a imitar).
- **Restrições:** o que **não** pode aparecer (texto ilegível, logos de terceiros, marcas, pessoas identificáveis), mãos/rostos plausíveis, geometria arquitetônica correta.
- **Output:** nº de variações, nome de arquivo, onde salvar, peso.

## 3. Modos de geração/edição (escolha o mínimo que resolve)

| Modo | Quando | Cuidado |
|---|---|---|
| Texto → imagem | fundo, atmosfera, ilustração, campanha sem imóvel real | Não gerar "o imóvel": gera um imóvel que não existe. |
| Imagem → imagem | variar luz/estilo mantendo a cena | Defina o que **preservar** (§5). |
| Referência de imagem | manter assunto/pessoa/produto | Direitos e consentimento de uso de imagem. |
| Referência de estilo | tom, paleta, textura | Extraia princípio; não imite obra/marca. |
| Referência de composição | manter layout/profundidade/bordas | Verifique a geometria depois. |
| Edição localizada (inpaint/outpaint) | remover objeto temporário, estender fundo | Máscara estreita; compare antes × depois. |
| Ativo com transparência | ícone, selo, recorte | Gerar sobre fundo liso e recortar com borda limpa; conferir halos em fundo claro e escuro. |
| Imagem de produto/imóvel | peça comercial | **Fiel ao real** (`PHOTOGRAPHY.md` §4). |
| Fotorrealismo × ilustração | foto: confiança/prova; ilustração: conceito e explicação | Não misturar na mesma peça sem intenção; não vender ilustração como foto. |

## 4. Honestidade e direitos

- Imagem gerada de imóvel/entorno **não pode ser apresentada como foto real** do imóvel à venda. Se for ilustrativa, diga "imagem ilustrativa".
- Pessoas: nada de depoimento, cliente ou "casal feliz" falso que insinue pessoa real. Foto de cliente real só com consentimento escrito (LGPD/direito de imagem).
- Não inventar benefício visual (vista, acabamento, área, piscina, localização). **FORMA muda; FATO não.**
- Direitos: sem imagem de terceiros sem licença; fontes/ícones livres; logos de bancos/programas (ex.: Caixa) só no uso institucional permitido.

## 5. Edição de foto real: **melhorar não é reconstruir**

Antes de editar, escreva duas listas:
- **MUTÁVEL:** exposição, contraste, balanço de branco, saturação, nitidez, ruído, recorte, alinhamento de verticais, remoção de objeto temporário (lixo, fio solto, carro de passagem), céu (só se honesto — `PHOTOGRAPHY.md`).
- **PRESERVADO (salvo pedido explícito):** arquitetura, proporções, paredes, portas, janelas, telhado, revestimentos, estrutura, posição de elementos fixos, tamanho dos cômodos, vista.
Depois da edição compare lado a lado e por sobreposição de bordas; qualquer mudança em **PRESERVADO** reprova. Mantenha o original intacto e entregue a edição com outro nome.

## 6. Verificação (Visual QA de imagem)

Composição e ponto focal · geometria (linhas verticais retas, horizonte nivelado, perspectiva coerente) · realismo (luz e sombras consistentes, reflexos, escala) · artefatos (dedos/mãos, texto distorcido, repetição de padrão, bordas serrilhadas, halos) · fidelidade ao real · preservação · como fica **em miniatura** e cortado para as proporções de uso · peso do arquivo.

## 7. Sem gerador disponível

Hoje o projeto não tem serviço de geração contratado. Entregue **o briefing completo (§2)**, lista de tomadas para fotógrafo/corretor (`PHOTOGRAPHY.md` §5) ou ajuste só o que for seguro localmente (recorte, exposição, balanço de branco) sem inventar conteúdo. Proponha ao dono a ferramenta (com custo, licença e privacidade) em vez de adotá-la.
