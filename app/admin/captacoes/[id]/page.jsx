import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, MessageCircle } from "lucide-react";
import AdminLogoutButton from "@/components/AdminLogoutButton";
import CaptacaoStatusSelect from "@/components/captacoes/CaptacaoStatusSelect";
import PublishCaptacaoButton from "@/components/captacoes/PublishCaptacaoButton";
import { requireGeneralAdminPage } from "@/lib/admin-auth";
import { formatDateTimeSaoPaulo } from "@/lib/date-utils";
import { getCaptacao } from "@/lib/captacoes";
import {
  CURRENT_SITUATION_OPTIONS,
  EXCHANGE_OPTIONS,
  SALE_TIMELINE_OPTIONS,
  formatCaptacaoMoney,
  formatCaptacaoPhone,
  formatCaptacaoType,
  getCaptacaoWhatsApp
} from "@/lib/captacoes-schema";

export const dynamic = "force-dynamic";

export default async function CaptacaoDetailPage({ params }) {
  const auth = await requireGeneralAdminPage();

  const { id } = await params;
  const captacao = await getCaptacao(id, auth);
  if (!captacao) notFound();

  const whatsappUrl = getCaptacaoWhatsApp(captacao.ownerPhone);
  const typeLabel = formatCaptacaoType(captacao.propertyType, captacao.propertyTypeOther);

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="min-w-0">
          <Link href="/admin/captacoes" className="inline-flex items-center gap-2 text-sm font-black text-brand transition hover:text-navy">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar para captações
          </Link>
          <p className="mt-6 text-sm font-black uppercase tracking-[0.18em] text-brand">Captação recebida</p>
          <h1 className="mt-3 truncate text-[clamp(2.25rem,6vw,4.5rem)] font-black leading-[0.95] text-navy">
            {captacao.ownerName}
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
            {typeLabel} enviado em {formatDateTimeSaoPaulo(captacao.createdAt)}.
          </p>
        </div>
        <AdminLogoutButton />
      </section>

      <section className="container-page grid gap-6">
        <div className="grid gap-4 rounded-[28px] border border-line bg-white p-6 shadow-soft lg:grid-cols-[1fr_auto] lg:items-center">
          <CaptacaoStatusSelect captacaoId={captacao.id} initialStatus={captacao.status} />
          <div className="flex flex-col gap-3 sm:flex-row">
            {whatsappUrl ? (
              <a className="premium-button-secondary" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
                WhatsApp
              </a>
            ) : null}
            {captacao.propertyId ? (
              <Link className="premium-button-secondary" href={`/admin/empreendimentos/${captacao.propertyId}`}>
                <ExternalLink className="h-5 w-5" aria-hidden="true" />
                Abrir rascunho
              </Link>
            ) : null}
            <PublishCaptacaoButton captacaoId={captacao.id} propertyId={captacao.propertyId} />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <InfoCard title="Proprietário">
            <InfoLine label="Nome" value={captacao.ownerName} />
            <InfoLine label="WhatsApp" value={formatCaptacaoPhone(captacao.ownerPhone)} />
            <InfoLine label="E-mail" value={captacao.ownerEmail || "Não informado"} />
          </InfoCard>

          <InfoCard title="Imóvel">
            <InfoLine label="Tipo" value={typeLabel} />
            <InfoLine label="Endereço" value={formatAddress(captacao)} />
            <InfoLine label="Cidade" value={[captacao.city, captacao.state].filter(Boolean).join(" / ")} />
          </InfoCard>

          <InfoCard title="Venda">
            <InfoLine label="Valor pretendido" value={captacao.requestsEvaluation ? "Solicitou avaliação" : (formatCaptacaoMoney(captacao.intendedPrice) || "Não informado")} />
            <InfoLine label="Prazo" value={optionLabel(SALE_TIMELINE_OPTIONS, captacao.saleTimeline) || "Não informado"} />
            <InfoLine label="Permuta" value={optionLabel(EXCHANGE_OPTIONS, captacao.exchangeAcceptance) || "Não informado"} />
            <InfoLine label="Situação atual" value={optionLabel(CURRENT_SITUATION_OPTIONS, captacao.currentSituation) || "Não informado"} />
            <InfoLine label="Motivo da venda" value={captacao.saleReason || "Não informado"} />
          </InfoCard>

          <InfoCard title="Características">
            <DetailsList details={captacao.details} />
          </InfoCard>
        </div>

        {captacao.notes ? (
          <InfoCard title="Observações">
            <p className="leading-8 text-muted">{captacao.notes}</p>
          </InfoCard>
        ) : null}

        <InfoCard title={`Fotos (${captacao.photos?.length || 0})`}>
          {captacao.photos?.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {captacao.photos.map((photo, index) => (
                <a
                  key={`${photo.data}-${index}`}
                  href={photo.data}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group overflow-hidden rounded-2xl border border-line bg-mist"
                >
                  <img
                    src={photo.data}
                    alt={`Foto ${index + 1} da captação de ${captacao.ownerName}`}
                    className="h-56 w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                  />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-muted">Nenhuma foto foi enviada.</p>
          )}
        </InfoCard>
      </section>
    </main>
  );
}

function InfoCard({ title, children }) {
  return (
    <article className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
      <h2 className="text-sm font-black uppercase tracking-[0.18em] text-brand">{title}</h2>
      <div className="mt-5 grid gap-3">{children}</div>
    </article>
  );
}

function InfoLine({ label, value }) {
  return (
    <div className="rounded-2xl bg-[#F7FAFF] px-4 py-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-1 break-words font-extrabold text-navy">{value || "Não informado"}</p>
    </div>
  );
}

function DetailsList({ details = {} }) {
  const differentials = Array.isArray(details.differentials)
    ? details.differentials.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  let rows = [
    ["Área", details.area],
    ["Área construída", details.builtArea],
    ["Área total", details.totalArea],
    ["Quartos", details.bedrooms],
    ["Suítes", details.suites],
    ["Banheiros", details.bathrooms],
    ["Vagas", details.parkingSpots],
    ["Condomínio", details.condominium],
    ["Piscina", details.hasPool ? "Sim" : ""],
    ["Churrasqueira", details.hasBarbecue ? "Sim" : ""],
    ["Elevador", details.hasElevator ? "Sim" : ""],
    ["Lazer completo", details.hasLeisure ? "Sim" : ""]
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  if (differentials.length) {
    rows = [...rows, ["Diferenciais", differentials.join(", ")]];
  }

  if (!rows.length) return <p className="text-muted">Nenhuma característica específica foi informada.</p>;

  return rows.map(([label, value]) => (
    <InfoLine key={label} label={label} value={String(value)} />
  ));
}

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label || "";
}

function formatAddress(captacao) {
  return [
    captacao.street,
    captacao.number,
    captacao.neighborhood
  ].filter(Boolean).join(", ") || "Endereço a confirmar";
}
