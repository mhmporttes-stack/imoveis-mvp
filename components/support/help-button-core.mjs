// Botão flutuante "?" (Ajuda) — regras puras, testadas em tests/support-help-button.test.mjs.
// Posição = a mesma do Henry (canto inferior ESQUERDO, acima da barra inferior; nunca à direita, onde ficam os botões
// flutuantes das telas): frontend-pwa.md "Henry no app". Se o Henry for religado, o "?" empilha acima dele.

export const HELP_LABEL_STORAGE_KEY = "mm-help-label-seen";
export const HELP_CHAT_WIDE_PX = 1024; // do tablet largo para cima a conversa convive com a lista (use-back-to-close usa o mesmo corte)

// Mesma conta do Henry no celular (HenryVoiceView: MOBILE_BOTTOM) — só soma a altura do anel quando ele está religado.
export const HELP_BOTTOM_BASE = "calc(0.75rem + max(env(safe-area-inset-bottom), var(--admin-bottom-nav-space, 0px)))";
export const HELP_HENRY_STACK_PX = 100; // anel grande do Henry no celular (88) + respiro
export const helpBottomOffset = (stackAboveHenry = false) => (stackAboveHenry ? `calc(${HELP_BOTTOM_BASE} + ${HELP_HENRY_STACK_PX}px)` : HELP_BOTTOM_BASE);

// Esconde com teclado aberto, dentro do Chat/Marketplace no celular (a conversa ocupa a tela), em gavetas/telas cheias
// (classe `ui-sheet-open`, tela cheia do Henry) e enquanto a própria gaveta da Ajuda está aberta.
export function isHelpButtonHidden({ typing = false, chatAppMode = false, viewportWidth = 0, overlayOpen = false, helpOpen = false } = {}) {
  if (typing || overlayOpen || helpOpen) return true;
  return chatAppMode && viewportWidth < HELP_CHAT_WIDE_PX;
}

// Legenda "Ajuda" só na 1ª vez. Storage pode não existir (navegação privada): tudo com try/catch, sem quebrar a tela.
export function shouldShowHelpLabel(storage) {
  try {
    return !storage || storage.getItem(HELP_LABEL_STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function markHelpLabelSeen(storage) {
  try {
    storage?.setItem(HELP_LABEL_STORAGE_KEY, "1");
  } catch {
    // sem armazenamento: a legenda só volta na próxima visita
  }
}

// Aviso ao DONO (dono, 2026-11-13): chamado sem resposta deixa o botão vermelho com selo de número (e o rótulo falado diz o
// número: não depende só de cor). Só quem vê a fila (`isOwner` = conta real do dono, fora de "Alterar conta"); os demais perfis
// nunca ficam vermelhos. Contagem inválida/ausente (ex.: sem a migration) = 0 = botão normal.
export const HELP_SUMMARY_POLL_MS = 60_000;

export function helpButtonTone({ isOwner = false, openCount = 0 } = {}) {
  const count = isOwner && Number.isFinite(Number(openCount)) ? Math.max(0, Math.floor(Number(openCount))) : 0;
  if (!count) return { alert: false, count: 0, badge: "", ariaLabel: "Ajuda" };
  return { alert: true, count, badge: count > 99 ? "99+" : String(count), ariaLabel: `Ajuda: ${count} ${count === 1 ? "chamado sem resposta" : "chamados sem resposta"}` };
}
