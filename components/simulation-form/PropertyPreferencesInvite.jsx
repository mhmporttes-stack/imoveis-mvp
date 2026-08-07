"use client";

import { ArrowRight, Handshake } from "lucide-react";

export default function PropertyPreferencesInvite({ onStart }) {
  return (
    <article className="mx-auto w-full max-w-3xl rounded-[32px] border border-line bg-white p-6 text-center shadow-soft sm:p-8 lg:p-10">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-blue-50 text-brand">
        <Handshake className="h-8 w-8" aria-hidden="true" />
      </div>

      <h1 className="mx-auto mt-7 max-w-2xl text-[clamp(2rem,4.4vw,3.4rem)] font-black leading-[1.04] text-navy">
        Cadastro concluído com sucesso! ✅
      </h1>

      <p className="mx-auto mt-5 max-w-2xl text-base font-semibold leading-8 text-muted sm:text-lg">
        Agora, responda algumas perguntas rápidas para que seu corretor entenda melhor o tipo de imóvel que você procura e apresente opções mais compatíveis com o seu perfil.
      </p>

      <p className="mt-3 text-sm font-black uppercase tracking-[0.18em] text-brand">
        Leva menos de 1 minuto.
      </p>

      <div className="mx-auto mt-8 max-w-md">
        <button
          className="premium-button-primary w-full justify-center"
          onClick={onStart}
          type="button"
        >
          Responder agora
          <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
