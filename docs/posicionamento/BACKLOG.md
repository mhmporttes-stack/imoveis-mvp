# BACKLOG — melhorias de posicionamento digital

> Memória do agente `marketing-posicionamento`. Máximo 7 itens **ativos**. Todo item tem evidência e checagem de falha. Se o valor inicial do indicador é desconhecido (sem Search Console, p. ex.), o 1º passo do item é obter esse acesso. Concluídos descem para a seção final com o resultado medido. Item importante que não cabe nos 7 vai para **Reserva** (substitui o ativo de menor prioridade só com justificativa).

## Ativos
| # | Prioridade | Melhoria | Evidência (fonte, data) | Quem | Como saber se falhou (indicador → prazo) | Status |
|---|---|---|---|---|---|---|
| 1 | P1 | Criar `robots.txt` e `sitemap.xml` (home + imóveis) | `curl` /robots.txt e /sitemap.xml = 404, 2026-10-01 [VERIFICADO] | Claude implementa; dono manda publicar e envia o sitemap ao Search Console | Falhou se, até 2026-11-01, o Search Console não mostrar o sitemap lido ou o nº de páginas indexadas não subir (valor inicial a registrar quando o dono der acesso) | Aberto |
| 2 | P1 | Title/description da home com posicionamento (primeiro imóvel, MCMV, Caixa, Marília) | title "Matheus Machado - Corretor de Imóveis"; description "Empreendimentos imobiliários em Marília com atendimento consultivo." 2026-10-01 [VERIFICADO] | Claude implementa; dono aprova o texto | Falhou se, até 2026-11-15, impressões de "primeiro imóvel Marília" no Search Console não saírem do valor inicial | Aberto |
| 3 | P1 | JSON-LD `RealEstateAgent` (nome, CRECI, tel., endereço, Instagram) na home | 0 blocos ld+json no HTML da home (curl, 2026-10-01) [VERIFICADO] | Claude implementa | Falhou se, até 2026-11-01, o teste de resultados enriquecidos do Google não validar o schema | Aberto |
| 4 | P2 | Trocar "Painel Matheus" por nome público nos metadados `application-name`/apple title | meta = "Painel Matheus" na home pública, 2026-10-01 [VERIFICADO] | Claude implementa | Falhou se, 1 dia após o deploy, o HTML ainda trouxer "Painel Matheus" | Aberto |
| 5 | P2 | Dono envia prints: painel do GMN (desempenho + avaliações), Instagram, Search Console | Maps/Instagram/GMN inacessíveis ao agente, 2026-10-01 [A CONFIRMAR] | Matheus | Falhou se, até 2026-10-08, as 6 áreas não medidas continuarem sem dado | Aberto |
| 6 | P2 | Checar busca de marca e Maps em Marília (homônimos e Matheus Soares aparecem) | WebSearch de marca sem o site dele, 2026-10-01 (amostra EUA, baixa confiança) | Matheus (print) ou Claude com Chrome autorizado | Falhou se, até 2026-10-15, a busca real no Brasil não mostrar o site dele nas 3 primeiras posições | Aberto |

## Concluídos / descartados (com resultado medido)
| Melhoria | Publicada em | Indicador antes → depois | Veredito |
|---|---|---|---|
