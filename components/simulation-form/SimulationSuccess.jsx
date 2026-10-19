import Image from "next/image";
import InstagramFollow from "@/components/simulation-form/InstagramFollow";
import ReceiveSimulationWhatsappButton from "@/components/simulation-form/ReceiveSimulationWhatsappButton";
import { CheckCircle2 } from "lucide-react";
import { ESTIMATE_DISCLAIMER } from "@/lib/financiamento-estimativa-core.mjs";
import { formatMoneyBR } from "@/lib/simulation-list-utils";

// Tela final da simulação: bloco de confirmação + botão "Receber minha simulação" (WhatsApp oficial) + convite para o
// Instagram. Visual limpo, azul e branco; só os botões do WhatsApp e do Instagram usam as cores das redes.
// Estimativa automática (regra do dono, 2026-10-19 — docs/BUSINESS_RULES.md SIM-AUTO): calculada só depois que o
// cadastro foi salvo (todo resultado vira lead), por lib/financiamento-estimativa-core.mjs. Sem estimativa (fora do MCMV
// ou dado faltando), a tela continua igual à de antes.
export default function SimulationSuccess({ brokerRef = "", registrationId = "", accessToken = "", estimate = null }) {
  const hasEstimate = Boolean(estimate?.eligible);
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
        {hasEstimate ? "Sua simulação estimada" : "Estamos adicionando seu atendimento"}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-base font-semibold leading-7 text-muted">
        {hasEstimate
          ? "Em instantes, um associado entrará em contato para confirmar os valores e orientar os próximos passos."
          : "Em instantes, um associado entrará em contato para apresentar os valores da sua simulação e orientar os próximos passos."}
      </p>

      {hasEstimate ? <EstimateResult estimate={estimate} /> : null}

      {/* Botão de volta (dono, 2026-10-11): sem ele o cliente não iniciava conversa nenhuma. Abre o WhatsApp OFICIAL com a
          mensagem pronta — a conversa entra no Chat com o card, vai para o corretor responsável e abre a janela de 24 h. */}
      <ReceiveSimulationWhatsappButton accessToken={accessToken} brokerRef={brokerRef} registrationId={registrationId} />

      <InstagramFollow eyebrow="Enquanto sua simulação é preparada..." />
    </article>
  );
}

function EstimateResult({ estimate }) {
  const percent = (value) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da renda`;
  const rate = estimate.annualRate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <section aria-label="Resultado da simulação estimada" className="mt-6 text-left">
      <div className="rounded-2xl bg-navy px-5 py-5 text-white">
        <p className="text-sm font-semibold text-white/80">Você pode comprar um imóvel de até</p>
        <p className="mt-1 text-[clamp(1.5rem,8vw,2.5rem)] font-black leading-tight tracking-[-0.02em] tabular-nums">{formatMoneyBR(estimate.purchasePower)}</p>
      </div>

      <p className="mt-3 text-center text-xs font-semibold leading-5 text-muted">
        Renda considerada na simulação: <span className="text-navy tabular-nums">{formatMoneyBR(estimate.income)}</span>
        {estimate.used && Math.abs(estimate.used.income - estimate.income) > 0.005 ? <> no imóvel novo e <span className="text-navy tabular-nums">{formatMoneyBR(estimate.used.income)}</span> no usado</> : null}
        {estimate.incomeAdjusted || (estimate.used && Math.abs(estimate.used.income - estimate.declaredIncome) > 0.005) ? <> (melhor cenário para o seu perfil; você informou {formatMoneyBR(estimate.declaredIncome)})</> : null}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:gap-3">
        <EstimateItem label="Valor financiado" value={formatMoneyBR(estimate.financing)} />
        <EstimateItem label="Subsídio estimado" value={formatMoneyBR(estimate.subsidy)} />
        <EstimateItem label="Entrada necessária" value={formatMoneyBR(estimate.downPayment)} />
        <EstimateItem label="Prazo" value={`${estimate.termMonths} meses`} note={`Juros de ${rate}% ao ano`} />
        <EstimateItem label="1ª parcela Price" value={formatMoneyBR(estimate.priceFirstInstallment)} note={`${percent(estimate.priceIncomeShare)} · parcelas quase iguais`} />
        <EstimateItem label="1ª parcela SAC" value={formatMoneyBR(estimate.sacFirstInstallment)} note={`${percent(estimate.sacIncomeShare)} · diminui todo mês`} />
      </dl>

      {estimate.used ? (
        <p className="mt-3 rounded-2xl bg-mist px-4 py-3 text-xs font-semibold leading-5 text-muted">
          Imóvel usado: subsídio estimado de <span className="text-navy tabular-nums">{formatMoneyBR(estimate.used.subsidy)}</span> · pode comprar até <span className="text-navy tabular-nums">{formatMoneyBR(estimate.used.purchasePower)}</span> · 1ª parcela Price <span className="text-navy tabular-nums">{formatMoneyBR(estimate.used.priceFirstInstallment)}</span>
        </p>
      ) : null}

      <p className="mt-3 text-center text-xs font-semibold leading-5 text-muted">{ESTIMATE_DISCLAIMER}</p>
    </section>
  );
}

function EstimateItem({ label, value, note = "" }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line px-3 py-3 sm:px-4">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-0.5 text-[clamp(0.8rem,4vw,1rem)] font-black text-navy tabular-nums">{value}</dd>
      {note ? <dd className="mt-0.5 text-xs leading-4 text-muted">{note}</dd> : null}
    </div>
  );
}
