// Fundo do Chat (WhatsApp e Marketplace, WA-38: mesmo visual nos dois). Movido de WhatsappChat.jsx sem mudança.
// Aparência "como no WhatsApp" (pedido do dono, 2026-10-09) — só apresentação.
// Fundo bege com desenhos de traço bem sutis (SVG próprio, inline, sem asset de terceiros).
export const CHAT_WALLPAPER_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260' viewBox='0 0 260 260'><g fill='none' stroke='#8C7E66' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' opacity='.16'>"
  + "<path d='M22 56 40 40l18 16v20H22Z M34 76V64h12v12'/>"
  + "<circle cx='160' cy='32' r='8'/><path d='M168 32h24m-8 0v8m6-8v6'/>"
  + "<path d='M98 104h36a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8h-22l-10 8v-8h-4a8 8 0 0 1-8-8v-16a8 8 0 0 1 8-8Z'/>"
  + "<path d='M214 116c-6-8-18-2-12 8l12 12 12-12c6-10-6-16-12-8Z'/>"
  + "<path d='m44 156 4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1Z'/>"
  + "<rect x='160' y='180' width='22' height='38' rx='4'/><path d='M168 212h6'/>"
  + "<path d='M84 222a10 10 0 0 1 18-6 8 8 0 0 1 14 6 7 7 0 0 1-2 14H86a7 7 0 0 1-2-14Z'/>"
  + "<circle cx='116' cy='44' r='2'/><circle cx='226' cy='70' r='2'/><circle cx='22' cy='116' r='2'/><circle cx='134' cy='170' r='2'/><circle cx='234' cy='236' r='2'/>"
  + "</g></svg>";
export const CHAT_WALLPAPER_STYLE = { backgroundColor: "#EFEAE2", backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(CHAT_WALLPAPER_SVG)}")`, backgroundSize: "260px 260px" };
