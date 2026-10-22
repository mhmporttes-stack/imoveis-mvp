// Velocidade do painel, etapa 3 (dono, 2026-10-22 — "sem remover nenhuma função… todas as cenas mantidas"):
// esqueleto na troca de tela, avisos globais carregados depois da tela e login fora do layout pesado do painel.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => fs.existsSync(new URL(`../${path}`, import.meta.url));

test("esqueleto: nunca nos destinos das cenas nem no Chat (não existe loading no nível de app/admin)", () => {
  assert.equal(exists("app/admin/loading.jsx"), false, "um loading em app/admin cobriria a Meta Diária e Clientes");
  for (const dir of ["meta-diaria", "simulacoes", "chat", "chat/marketplace", "alexa"]) {
    assert.equal(exists(`app/admin/${dir}/loading.jsx`), false, dir);
  }
  for (const dir of ["inicio", "financeiro", "prospeccao", "desempenho", "simulacoes/[id]", "meta-diaria/gestao"]) {
    assert.match(read(`app/admin/${dir}/loading.jsx`), /AdminRouteLoading/, dir);
  }
  const skeleton = read("components/AdminRouteLoading.jsx");
  assert.match(skeleton, /data-admin-route-loading/);
  assert.match(skeleton, /data-no-reveal/);
  assert.doesNotMatch(skeleton, /<img|logo/i, "sem logo no esqueleto");
});

test("entrada por rolagem espera o esqueleto sair antes da primeira varredura", () => {
  const reveal = read("components/motion/AdminScrollReveal.jsx");
  assert.match(reveal, /querySelector\("\[data-admin-route-loading\]"\)/);
  assert.match(reveal, /revealOnScroll\(root\)/);
});

test("avisos globais: mesmos gates, carregados depois que a tela fica ociosa, com as mesmas condições", () => {
  const layout = read("app/admin/layout.jsx");
  for (const gate of ["AlertCenterGate", "SupervisionMessageGate", "BrokerCelebrationGate", "DailyMessageGate"]) {
    assert.doesNotMatch(layout, new RegExp(`import ${gate} `), `${gate} não entra no JS inicial do layout`);
  }
  assert.match(layout, /supervision=\{auth\.accountSwitchMode \? null : \{ userId: auth\.profile\?\.id \}\}/);
  assert.match(layout, /alerts=\{auth\.accountSwitchMode \? null : \{ userId: auth\.profile\?\.id \}\}/);
  // o que não é aviso continua síncrono: som da roleta (aba oculta), Henry, primeiro acesso e as cenas
  assert.match(layout, /import NewClientSoundListener from/);
  assert.match(layout, /import HenryVoiceAssistant from/);
  assert.match(layout, /import FirstAccessGate from/);
  assert.match(layout, /import SceneTransitionRoot from/);
  const deferred = read("components/DeferredPanelGates.jsx");
  for (const gate of ["DailyMessageGate", "BrokerCelebrationGate", "SupervisionMessageGate", "AlertCenterGate"]) {
    assert.match(deferred, new RegExp(`const ${gate} = dynamic\\(\\(\\) => import\\("@/components/[a-z/]*${gate}"\\), \\{ ssr: false \\}\\)`), gate);
  }
  assert.match(deferred, /requestIdleCallback/);
  // ordem de montagem de sempre
  const order = ["<DailyMessageGate", "<BrokerCelebrationGate", "<SupervisionMessageGate", "<AlertCenterGate"].map((tag) => deferred.indexOf(tag));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("login e redefinir senha fora do layout do painel, no mesmo endereço /admin/...", () => {
  assert.equal(exists("app/admin/login/page.jsx"), false);
  assert.equal(exists("app/admin/reset-password/page.jsx"), false);
  assert.match(read("app/painel-acesso/login/page.jsx"), /AdminTwoFactorChallenge/);
  assert.match(read("app/painel-acesso/reset-password/page.jsx"), /AdminResetPasswordForm/);
  const layout = read("app/painel-acesso/layout.jsx");
  assert.match(layout, /ADMIN_FONT_CSS/);
  assert.doesNotMatch(layout, /AdminMenu|AdminTopBar|AdminBottomNav|SceneTransitionRoot|DeferredPanelGates/);
  const proxy = read("proxy.js");
  assert.match(proxy, /if \(isPublicAdminPath\(pathname\)\) \{[\s\S]*?NextResponse\.rewrite\(target\)/);
  assert.match(proxy, /const PAINEL_ACESSO_PREFIX = "\/painel-acesso"/);
  // a reescrita vem antes da checagem de sessão: login nunca exige cookie
  assert.ok(proxy.indexOf("if (isPublicAdminPath(pathname))") < proxy.indexOf("isAdminPath && !isPublicAdminPath(pathname)"));
});
