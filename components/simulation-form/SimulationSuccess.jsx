import Image from "next/image";
import InstagramFollow from "@/components/simulation-form/InstagramFollow";
import ReceiveSimulationWhatsappButton from "@/components/simulation-form/ReceiveSimulationWhatsappButton";
import { CheckCircle2 } from "lucide-react";

// Tela final da simulação: confirmação curta + botão do WhatsApp oficial + convite para o Instagram. Visual limpo, azul e
// branco; só os botões do WhatsApp e do Instagram usam as cores das redes.
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] "Ir direto ao WhatsApp": ao confirmar a última pergunta o cliente é levado
// sozinho ao WhatsApp com a mensagem pronta; a simulação chega por lá (SIM-AUTO-ENVIO). Desde o refinamento do mesmo dia
// ("sem essa outra aba") o formulário abre o WhatsApp direto do botão "Enviar informações" e esta tela só aparece como
// reserva: troca de app não aconteceu em ~3 s (`whatsappAlreadyOpened`) ou WA-10 em espera/indisponível (`autoOpenWhatsapp`).
// Por isso a tela não mostra mais os valores da estimativa ("não acho que essa página faz sentido") — só "Recebemos, <nome>"
// e o botão "Abrir o WhatsApp" de reserva, caso o WhatsApp não abra. O botão não sai sem o dono (WA-10).
export default function SimulationSuccess({ brokerRef = "", registrationId = "", accessToken = "", firstName = "", autoOpenWhatsapp = false, whatsappAlreadyOpened = false }) {
  const name = String(firstName || "").trim();
  return (
    <article className="mx-auto w-full max-w-xl rounded-[28px] border border-line bg-white px-6 py-8 text-center shadow-[0_24px_70px_rgba(13,59,102,0.12)] sm:px-10 sm:py-10">
      <div className="relative mx-auto h-12 w-44 sm:h-14 sm:w-52">
        <Image
          alt="Caixa"
          className="object-contain"
          fill
          priority
          sizes="208px"
          src="/assets/caixa-logo-transparent.png"
        />
      </div>

      <div className="mx-auto mt-6 grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-brand">
        <CheckCircle2 aria-hidden="true" className="h-8 w-8" />
      </div>

      <h1 className="mt-5 text-[clamp(1.55rem,5.5vw,2.1rem)] font-black leading-tight tracking-[-0.02em] text-navy">
        {name ? `Recebemos, ${name}.` : "Recebemos seu cadastro."}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-base font-semibold leading-7 text-muted">
        Sua simulação vai chegar pelo WhatsApp.
      </p>

      {/* Botão de volta (dono, 2026-10-11): sem ele o cliente não iniciava conversa nenhuma. Abre o WhatsApp OFICIAL com a
          mensagem pronta — a conversa entra no Chat com o card, vai para o corretor responsável e abre a janela de 24 h.
          Desde 2026-10-24 o formulário abre o mesmo link direto do "Enviar informações"; o botão fica de reserva. */}
      <ReceiveSimulationWhatsappButton accessToken={accessToken} alreadyOpened={whatsappAlreadyOpened} autoOpen={autoOpenWhatsapp} brokerRef={brokerRef} registrationId={registrationId} />

      <InstagramFollow eyebrow="Enquanto sua simulação é preparada..." />
    </article>
  );
}
