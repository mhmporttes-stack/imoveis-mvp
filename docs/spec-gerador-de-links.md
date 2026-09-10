# Gerador de Links — Especificação Técnica

## 1. Visão geral

Nova funcionalidade em **Gestão → Gerador de Links**, que permite criar URLs exclusivas de campanha, vinculadas a uma regra de distribuição (roleta ou corretor específico), e rastrear automaticamente a origem de cada cadastro.

Fluxo:
```
Anúncio → Link exclusivo → Site/Formulário → Cadastro → CRM identifica campanha
→ Registra origem (permanente) → Adiciona tag → Distribui (roleta ou corretor)
```

O cadastro convencional (sem link de campanha) permanece 100% inalterado.

---

## 2. Modelo de dados

### Tabela `campaigns`
| Campo | Tipo | Descrição |
|---|---|---|
| `id` | UUID (PK) | Identificador único interno — é isso que vai na URL, não o nome |
| `name` | string | Nome da campanha (ex: "Facebook - Terras de São Paulo") — editável a qualquer momento |
| `destination_type` | enum(`roulette`, `broker`) | Regra de distribuição |
| `broker_id` | FK → `brokers.id`, nullable | Preenchido só quando `destination_type = broker` |
| `status` | enum(`active`, `inactive`) | Ativar/Desativar sem apagar histórico |
| `created_at` | timestamp | Data de criação |
| `slug` | string, opcional | Se quiser um trecho legível na URL além do id (ex: `/l/facebook-terras-sp-8f3a`) — cosmético, a lógica sempre usa o `id` |

> **Importante**: o link gerado usa `campaigns.id`, nunca `campaigns.name`. Isso garante que renomear a campanha depois não quebra anúncios já publicados.

### Tabela `client_origins` (ou campo em `clients`)
| Campo | Tipo | Descrição |
|---|---|---|
| `client_id` | FK → `clients.id` | |
| `campaign_id` | FK → `campaigns.id`, nullable | `null` = cadastro direto/orgânico |
| `campaign_name_snapshot` | string | Cópia do nome da campanha **no momento do cadastro** — garante que a origem histórica não mude nem se a campanha for renomeada ou apagada depois |
| `created_at` | timestamp | |

Isso resolve o requisito de "origem é permanente": mesmo que a campanha seja editada/desativada depois, o snapshot preserva o dado histórico exato.

### Tags no cliente
- Ao concluir o cadastro via link de campanha, o sistema adiciona automaticamente uma tag ao cliente com o nome da campanha (snapshot no momento do cadastro).
- A tag segue as regras normais de tag do CRM (aparece no card, não desaparece com transferência de corretor).
- Se depois a campanha for renomeada, a tag do cliente **não muda retroativamente** (ela é independente, criada a partir do snapshot) — só campanhas criadas dali pra frente usam o novo nome.

---

## 3. Regras de negócio

1. **Geração do link**: ao clicar em "Gerar Link", cria-se um registro em `campaigns` e retorna uma URL do tipo:
   `https://seusite.com.br/cadastro?c=<campaign_id>` (ou rota dedicada `/l/<campaign_id>`).
2. **Cadastro via link**: o formulário de cadastro precisa capturar o parâmetro da campanha (via query string, cookie de sessão ou hidden field) e enviá-lo junto no submit.
3. **No submit**:
   - Buscar `campaigns` pelo `id`.
   - Se `status = inactive`: o link **continua aceitando o cadastro normalmente** (não vira página de erro). Porém, o cliente **não recebe a tag da campanha** e **não é distribuído pela regra da campanha** (roleta amarrada ou corretor específico) — cai no fluxo padrão de cadastro comum, como se não tivesse vindo de nenhum link. Isso evita perder um lead que clicou num link já desativado (ex: anúncio com atraso pra sair do ar), sem exigir bloqueio manual do link.
   - Criar o cliente normalmente.
   - Gravar `client_origins` com o snapshot do nome.
   - Adicionar a tag ao cliente.
   - Aplicar a distribuição:
     - `roulette` → entra no fluxo de roleta já existente, sem alterações.
     - `broker` → atribui direto ao `broker_id`, pulando a roleta.
4. **Cadastro sem link**: comportamento atual, sem nenhuma mudança — `campaign_id = null`.
5. **Exclusão de campanha**: bloqueada (ou só "soft delete"/inativação) se houver clientes vinculados. Sugestão: nunca permitir hard delete, só `status = inactive`; isso já resolve a exigência de preservar histórico.
6. **Contagem de cadastros**: `COUNT` simples de `client_origins` por `campaign_id` — sem necessidade de tracking de cliques nesta fase.

---

## 4. Tela "Gerador de Links" (Gestão)

### 4.1 Criar novo link
Formulário simples, em ordem:
1. Nome da campanha (texto livre)
2. Destino: Roleta / Corretor específico (toggle ou radio)
3. Se "Corretor específico" → dropdown com a lista de corretores da equipe
4. Botão "Gerar Link" → cria o registro e mostra a URL com botão "Copiar"

### 4.2 Listagem de campanhas
Tabela com colunas:

| Nome da campanha | Destino | Corretor | Cadastros | Criado em | Status | Ações |
|---|---|---|---|---|---|---|

Ações por linha:
- **Copiar link**
- **Editar** (nome e/ou destino — não altera histórico já registrado)
- **Ativar/Desativar**
- **Ver clientes** (filtra a lista de clientes por `campaign_id`)

---

## 5. Pontos de atenção para a implementação

- O parâmetro de campanha precisa sobreviver até o submit do formulário mesmo se o usuário navegar por mais de uma página do site antes de cadastrar (usar cookie/localStorage com expiração razoável, não só query string).
- Editar uma campanha (nome ou destino) **não deve reprocessar** clientes antigos — só vale para cadastros futuros.
- Ao desativar uma campanha, o link continua no ar e aceitando cadastro, mas para de aplicar tag e regra de distribuição — o cadastro cai no fluxo padrão (comum), sem perder o lead. O link continua existindo para fins de relatório/histórico.
- Deixar a porta aberta para depois: campo de cliques/visitas pode ser adicionado futuramente sem quebrar esse modelo, bastaria uma tabela `campaign_visits` separada.

---

## 6. Fora de escopo (fase 1, conforme definido)

- Tracking de cliques/analytics de acesso.
- Relatórios de conversão e ROI por campanha.
- Múltiplas regras de distribuição além de roleta/corretor único (ex: por região, por prioridade).
