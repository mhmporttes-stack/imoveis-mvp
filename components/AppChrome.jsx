"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import AdminPushSubscription from "@/components/AdminPushSubscription";
import AdminPwaInstallHint from "@/components/AdminPwaInstallHint";
import AdminSessionKeeper from "@/components/AdminSessionKeeper";
import CampaignLinkCapture from "@/components/CampaignLinkCapture";
import MobileAdminEntryRedirect from "@/components/MobileAdminEntryRedirect";
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

  return (
    <>
      <PwaLifecycle />
      <ViewportZoomLock />
      {!isAdminRoute ? <MetaPixel /> : null}
      {!isAdminRoute ? <CampaignLinkCapture /> : null}
      {isAdminRoute ? (
        <>
          <MobileAdminEntryRedirect />
          <AdminSessionKeeper />
          <AdminPwaInstallHint />
          <AdminPushSubscription />
        </>
      ) : null}
      {!isAdminRoute ? <Header /> : null}
      {children}
      {!isAdminRoute ? <Footer /> : null}
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
