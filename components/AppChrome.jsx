"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import AdminPushSubscription from "@/components/AdminPushSubscription";
import AdminPwaInstallHint from "@/components/AdminPwaInstallHint";
import AdminSessionKeeper from "@/components/AdminSessionKeeper";
import CampaignLinkCapture from "@/components/CampaignLinkCapture";
import MobileAdminEntryRedirect from "@/components/MobileAdminEntryRedirect";
import FinanceiroAppGuard from "@/components/FinanceiroAppGuard";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import InstagramFloatingButton from "@/components/InstagramFloatingButton";
import LeadCaptureModal from "@/components/LeadCaptureModal";
import MetaPixel from "@/components/MetaPixel";
import PwaLifecycle from "@/components/PwaLifecycle";
import ViewportZoomLock from "@/components/ViewportZoomLock";
import WhatsAppFloatingButton from "@/components/WhatsAppFloatingButton";
import WhatsAppSimulationPrompt from "@/components/WhatsAppSimulationPrompt";

export default function AppChrome({ children }) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin");
  const isSimulationRoute = pathname?.startsWith("/simulacao");

  // overflow-x:hidden no body (regra global, ver globals.css) promove
  // overflow-y para "auto" e quebra position: sticky de qualquer elemento —
  // é o que a barra fixa do Top 1 do ranking (app/admin/layout.jsx) usa.
  // Escopado só às rotas /admin para não alterar o comportamento das
  // páginas públicas do site.
  useEffect(() => {
    document.body.classList.toggle("admin-scroll-fix", Boolean(isAdminRoute));
  }, [isAdminRoute]);

  if (pathname?.startsWith("/minha-jornada/")) return children;
  // App "Chat" da tela inicial (/chat-app, 2026-10-09): só o Chat, sem cabeçalho/rodapé do site nem o
  // painel em volta — funciona igual aberto como app ou numa aba do Safari. Mantém sessão e notificações.
  if (pathname === "/chat-app") {
    return (
      <>
        <PwaLifecycle />
        <ViewportZoomLock />
        <AdminSessionKeeper />
        <AdminPushSubscription />
        {children}
      </>
    );
  }
  // Apresentação interativa da simulação (/s/<token> reescrito para /apresentacao/<token> pelo proxy.js): tela cheia,
  // sem cabeçalho/rodapé/botões do site, sem Pixel nem captura de campanha. O ref curto /s/{ref} é só redirecionamento.
  if (pathname?.startsWith("/apresentacao/") || /^\/s\/[A-Za-z0-9]{24}\/?$/.test(pathname || "")) return children;
  // Vitrine de componentes (app/dev/vitrine) — rota que só existe no
  // `next dev`; renderiza sem o cabeçalho/rodapé do site público.
  if (pathname?.startsWith("/dev/")) return children;
  // Academia (rota própria, fora do /admin): sem cabeçalho/rodapé do site,
  // Pixel, captura de campanha nem botões flutuantes. Sem ViewportZoomLock:
  // o zoom fica liberado só aqui. Renova a sessão (prova longa).
  if (pathname?.startsWith("/academia")) {
    return (
      <>
        <PwaLifecycle />
        <AdminSessionKeeper />
        {children}
      </>
    );
  }

  return (
    <>
      <PwaLifecycle />
      <ViewportZoomLock />
      {!isAdminRoute ? <MetaPixel /> : null}
      {!isAdminRoute ? <CampaignLinkCapture /> : null}
      {isAdminRoute ? (
        <>
          <MobileAdminEntryRedirect />
          <FinanceiroAppGuard />
          <AdminSessionKeeper />
          <AdminPwaInstallHint />
          <AdminPushSubscription />
        </>
      ) : null}
      {!isAdminRoute ? <Header /> : null}
      {children}
      {/* Simulação (/simulacao): só o questionário, sem rodapé do site (pedido do dono, 2026-10-05). */}
      {!isAdminRoute && !isSimulationRoute ? <Footer /> : null}
      {!isAdminRoute && !isSimulationRoute ? (
        <>
          <LeadCaptureModal />
          <WhatsAppSimulationPrompt />
          <InstagramFloatingButton />
          <WhatsAppFloatingButton />
        </>
      ) : null}
    </>
  );
}
