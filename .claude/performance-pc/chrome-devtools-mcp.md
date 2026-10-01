# Chrome DevTools MCP — integração preparada (NÃO ativa)

Servidor oficial `ChromeDevTools/chrome-devtools-mcp` (Google, Apache-2.0, ~53k estrelas, muito ativo). Dá ao Claude traces de performance, requisições de rede, console, snapshot de memória, Lighthouse e screenshots do Chrome.

## Por que está desativado

- **Node.js não está instalado neste PC** (verificado em 2026-10-01: sem `node`/`npx`; o MCP roda via `npx`). Instalar é mudança no computador → exige "sim" do dono.
- Expõe ao agente tudo o que está nas páginas abertas (inclusive logadas). Só use com perfil isolado ou com permissão do dono.
- Por isso **não** foi colocado em `.mcp.json` (carregaria em todas as sessões do CRM e falharia sem Node).

## Para ativar (após autorização)

1. Instalar Node.js LTS (fonte oficial: `winget install OpenJS.NodeJS.LTS`, pede autorização).
2. Registrar só neste PC, escopo de usuário, com privacidade máxima:
   ```
   claude mcp add chrome-devtools --scope user -- npx -y chrome-devtools-mcp@latest --isolated --no-usage-statistics --no-performance-crux
   ```
   (`--isolated` = Chrome temporário sem seu perfil/logins; `--no-usage-statistics` e `--no-performance-crux` = nada é enviado ao Google.) Alternativa oficial com skills prontas: plugin `/plugin marketplace add ChromeDevTools/chrome-devtools-mcp` + `/plugin install chrome-devtools-mcp@chrome-devtools-plugins`.
3. Para analisar o **seu** Chrome já aberto (páginas logadas como o ChatGPT): iniciar o Chrome com depuração remota num perfil dedicado e usar `--browserUrl=http://127.0.0.1:9222`; nunca deixe a porta 9222 aberta em perfil com logins sem necessidade (o coletor mostra `depuracaoRemota9222Ativa`).
4. Teste: pedir "verifique a performance de https://developers.chrome.com".

Observação: o MCP só testa o que o Chrome renderiza; CPU/RAM do sistema continuam vindo do `coletar.ps1`.
