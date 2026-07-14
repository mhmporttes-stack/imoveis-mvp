import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import LeadCaptureModal from "@/components/LeadCaptureModal";
import WhatsAppFloatingButton from "@/components/WhatsAppFloatingButton";
import WhatsAppSimulationPrompt from "@/components/WhatsAppSimulationPrompt";
import { Analytics } from '@vercel/analytics/next';

export const metadata = {
  title: "Matheus Machado - Corretor de Imóveis",
  description: "Empreendimentos imobiliários em Marília com atendimento consultivo."
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>
        <Header />
        {children}
        <Footer />
        <LeadCaptureModal />
        <WhatsAppSimulationPrompt />
        <WhatsAppFloatingButton />
        <Analytics />
      </body>
    </html>
  );
}
