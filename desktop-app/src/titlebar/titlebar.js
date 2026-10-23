// Barra de título do app (página local). Só conversa com o app pela ponte própria window.mmTitlebar
// (titlebar-preload.js) — nada do CRM chega aqui e nada daqui vai para o CRM.
"use strict";
(function () {
  const bridge = window.mmTitlebar;
  if (!bridge) return;
  const maximize = document.getElementById("maximize");
  for (const button of document.querySelectorAll("button[data-command]")) {
    button.addEventListener("click", () => bridge.send(button.dataset.command));
  }
  bridge.onState((state) => {
    document.body.classList.toggle("visible", Boolean(state.visible));
    document.body.classList.toggle("pinned", Boolean(state.pinned));
    document.body.classList.toggle("maximized", Boolean(state.maximized));
    const label = state.maximized ? "Restaurar" : "Maximizar";
    maximize.title = label;
    maximize.setAttribute("aria-label", label);
  });
})();
