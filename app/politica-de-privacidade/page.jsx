import Link from "next/link";

export const metadata = {
  title: "Política de Privacidade | Matheus Machado",
  description: "Política de privacidade do site Matheus Machado - Corretor de Imóveis."
};

export default function PrivacyPolicyPage() {
  return (
    <main className="bg-mist py-20">
      <section className="container-page rounded-[30px] border border-line bg-white p-8 shadow-soft md:p-12">
        <p className="text-sm font-black uppercase tracking-[0.22em] text-brand">Privacidade</p>
        <h1 className="mt-4 text-4xl font-black leading-tight text-navy md:text-5xl">
          Política de Privacidade
        </h1>
        <div className="mt-8 grid gap-6 text-base leading-8 text-muted">
          <p>
            Os dados enviados pelo site são utilizados para atendimento imobiliário, contato por WhatsApp ou e-mail e envio de informações relacionadas aos imóveis de interesse.
          </p>
          <p>
            Coletamos apenas as informações necessárias para responder à solicitação, como nome, telefone e a página onde o cadastro foi realizado.
          </p>
          <p>
            As informações não são vendidas ou compartilhadas para fins comerciais externos. O visitante pode solicitar a atualização ou remoção dos dados entrando em contato pelos canais oficiais do site.
          </p>
        </div>
        <Link href="/" className="premium-button-primary mt-10">
          Voltar ao site
        </Link>
      </section>
    </main>
  );
}
