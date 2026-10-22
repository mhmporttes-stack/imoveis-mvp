// Plano do pré-carregamento do painel (components/AdminWarmup.jsx) — regra pura, testada em tests/admin-warmup-plan.test.mjs.
// Dono, 2026-10-22: "Todos os botões do aplicativo devem já ser pré-carregados. Carregue primeiro a aba Clientes e depois
// vá carregando tudo junto" (celular) e "no desktop, quero que TODAS as opções estejam pré-carregadas".
//
// Ordem: 1) Clientes; 2) destinos da barra inferior + atalhos do cabeçalho (Chat, Marketplace, Agenda); 3) todos os itens
// do menu do perfil (menu lateral no computador / folha "Mais" no celular), na ordem do menu.
// - "full": a tela inteira montada pelo servidor (o mesmo que abrir a tela; só leitura) fica guardada no navegador.
// - "auto": só o caminho/código da rota, sem montar a tela no servidor.

// Telas que NUNCA são montadas pelo pré-carregamento (só a rota):
export const ROUTE_ONLY_PATHS = new Map([
  // MD-16 (dono, 2026-10-19): a Meta do dia monta só quando a pessoa abre a Meta (abrir a tela gera/fecha o dia).
  ["/admin/meta-diaria", "Meta Diária só monta quando a pessoa abre (MD-16)"],
  // Abrir Anúncios pode buscar miniaturas novas na Meta e gravar no banco (getAdsBoard → syncMetaAdCreatives).
  ["/admin/anuncios", "abrir a tela chama a Meta e grava miniaturas"],
  // Início: números do mês (consulta pesada) e tela em construção por outra frente em 2026-10-22.
  ["/admin/inicio", "números do mês pesados; tela em construção"],
  // Alexa: configuração do dono, fala/integração externa — não vale a pena montar à toa.
  ["/admin/alexa", "integração externa (Alexa)"]
]);

// Janelas: a tela pré-carregada vale 5 min no navegador (staleTimes do Next), então a barra/cabeçalho é refeita no máximo
// a cada 5 min, e só quando a pessoa está usando o app (volta ao app ou troca de tela) — nunca por relógio. O menu inteiro
// (telas mais pesadas) no máximo a cada 30 min.
export const PRIMARY_WINDOW_MS = 5 * 60 * 1000;
export const MENU_WINDOW_MS = 30 * 60 * 1000;

export function routePath(href) {
  return String(href || "").split("?")[0].split("#")[0];
}

export function isRouteOnly(href) {
  return ROUTE_ONLY_PATHS.has(routePath(href));
}

// Monta as duas filas. `slow` (economia de dados / 2G): só as rotas da barra e do cabeçalho, sem montar tela e sem menu.
export function buildWarmupPlan({ clientsHref = "/admin/simulacoes", primaryHrefs = [], menuHrefs = [], currentPath = "", slow = false } = {}) {
  const seen = new Set();
  const current = routePath(currentPath);
  const take = (href) => {
    if (!href || !href.startsWith("/admin") || seen.has(href)) return null;
    seen.add(href);
    if (href === current) return null; // a tela atual já está aberta
    return { href, kind: slow || isRouteOnly(href) ? "auto" : "full" };
  };
  const primary = [clientsHref, ...primaryHrefs].map(take).filter(Boolean);
  const menu = slow ? [] : menuHrefs.map(take).filter(Boolean);
  return { primary, menu };
}

export function isDue(lastAt, now, windowMs) {
  return !Number.isFinite(lastAt) || lastAt <= 0 || now - lastAt >= windowMs;
}
