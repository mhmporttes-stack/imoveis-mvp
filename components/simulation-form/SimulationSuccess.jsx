import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

export default function SimulationSuccess() {
  return (
    <article className="mx-auto max-w-2xl rounded-[32px] border border-line bg-white p-8 text-center shadow-soft sm:p-12">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-blue-50 text-brand">
        <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
      </span>
      <h1 className="mt-7 text-[clamp(2rem,4vw,3rem)] font-black leading-tight text-navy">
        Informações enviadas com sucesso!
      </h1>
      <p className="mt-4 text-lg leading-8 text-muted">
        Recebemos os seus dados. Agora vamos analisar o seu perfil para verificar as possibilidades de financiamento.
      </p>
      <Link href="/" className="mt-8 inline-flex premium-button-primary">
        Voltar para o início
      </Link>
    </article>
  );
}
