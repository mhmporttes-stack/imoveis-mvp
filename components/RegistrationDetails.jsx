import {
  booleanLabel,
  calculateFamilyIncome,
  formatCurrency,
  formatDateBR,
  formatDateTimeBR,
  incomeTypeLabel,
  maritalStatusLabel,
  simulationTypeLabel
} from "@/lib/simulation-registration-schema";

export default function RegistrationDetails({ registration }) {
  const familyIncome = calculateFamilyIncome(registration);

  return (
    <div className="container-page grid gap-6">
      <DetailsBlock title="Dados do cliente">
        <DetailsItem label="Nome completo" value={registration.fullName} />
        <DetailsItem label="Número de celular" value={registration.phone} />
        <DetailsItem label="Data de nascimento" value={formatDateBR(registration.oldestBirthDate)} />
        <DetailsItem label="Tipo de simulação" value={simulationTypeLabel(registration.simulationType)} />
        <DetailsItem label="Data e hora do cadastro" value={formatDateTimeBR(registration.createdAt)} />
      </DetailsBlock>

      <DetailsBlock title="Renda do titular">
        <DetailsItem label="Tipo de renda" value={incomeTypeLabel(registration.primaryIncomeType)} />
        <DetailsItem label="Renda mensal" value={formatCurrency(registration.primaryMonthlyIncome)} />
      </DetailsBlock>

      {registration.simulationType === "joint" ? (
        <DetailsBlock title="Segunda pessoa">
          <DetailsItem label="Tipo de renda" value={incomeTypeLabel(registration.secondaryIncomeType)} />
          <DetailsItem label="Renda mensal" value={formatCurrency(registration.secondaryMonthlyIncome)} />
          <DetailsItem label="Estado civil" value={maritalStatusLabel(registration.secondaryMaritalStatus)} />
        </DetailsBlock>
      ) : null}

      <DetailsBlock title="Perfil do financiamento">
        <DetailsItem
          label="Possui mais de 3 anos de trabalho registrado"
          value={booleanLabel(registration.hasOverThreeYearsRegisteredWork)}
        />
        <DetailsItem label="Possui filhos menores de 18 anos" value={booleanLabel(registration.hasChildrenUnder18)} />
        <DetailsItem label="Estado civil do titular" value={maritalStatusLabel(registration.primaryMaritalStatus)} />
        <DetailsItem label="Possui imóvel residencial no nome" value={booleanLabel(registration.hasResidentialProperty)} />
        <DetailsItem label="Valor disponível para a compra" value={formatCurrency(registration.availablePurchaseResource)} />
        <DetailsItem label="Renda familiar total" value={formatCurrency(familyIncome)} />
      </DetailsBlock>
    </div>
  );
}

function DetailsBlock({ children, title }) {
  return (
    <section className="rounded-[28px] border border-line bg-white p-6 shadow-soft sm:p-8">
      <h2 className="text-2xl font-black text-navy">{title}</h2>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

function DetailsItem({ label, value }) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50 px-5 py-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-2 text-lg font-black leading-tight text-navy">{value || "Não informado"}</p>
    </div>
  );
}
