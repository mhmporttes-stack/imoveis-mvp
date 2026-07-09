# Matheus Machado Imóveis

Sistema imobiliário profissional em Next.js + Tailwind CSS, com área pública, painel administrativo, SQLite e backup diário.

## Stack

- Next.js App Router
- React
- Tailwind CSS
- SQLite nativo do Node.js
- API Routes para CRUD dos empreendimentos
- Estrutura preparada para crescer com componentes reutilizáveis

## Rotas

- `/` - homepage pública
- `/empreendimentos/[id]` - página individual do empreendimento
- `/admin` - painel administrativo
- `/admin/novo` - cadastro
- `/admin/empreendimentos/[id]` - edição
- `/api/properties` - API de listagem/cadastro
- `/api/properties/[id]` - API de detalhe/edição/exclusão
- `/api/analyze` - interpretação de site/PDF com IA

## Dados

O banco fica em:

```text
data/imoveis.sqlite
```

Backups diários:

```text
data/backups
```

## Rodar

```powershell
pnpm install
pnpm dev
```

Abra:

```text
http://localhost:3000
```

Neste ambiente do Codex, o comando direto também funciona:

```powershell
C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe node_modules\next\dist\bin\next dev -p 3000
```

Para IA real, defina `OPENAI_API_KEY` antes de iniciar o servidor.
