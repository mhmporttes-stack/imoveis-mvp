"use client";

import { usePathname } from "next/navigation";
import AdminPwaInstallHint from "@/components/AdminPwaInstallHint";
import AdminSessionKeeper from "@/components/AdminSessionKeeper";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import InstagramFloatingButton from "@/components/InstagramFloatingButton";
import LeadCaptureModal from "@/components/LeadCaptureModal";
import PwaLifecycle from "@/components/PwaLifecycle";
import WhatsAppFloatingButton from "@/components/WhatsAppFloatingButton";
import WhatsAppSimulationPrompt from "@/components/WhatsAppSimulationPrompt";

export default function AppChrome({ children }) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin");
  const isSimulationRoute = pathname?.startsWith("/simulacao");

  return (
    <>
      <PwaLifecycle />
      {isAdminRoute ? (
        <>
          <AdminSessionKeeper />
          <AdminPwaInstallHint />
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
