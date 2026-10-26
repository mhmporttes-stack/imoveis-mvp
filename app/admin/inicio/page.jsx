import { Suspense } from "react";
import { requireAdminPage } from "@/lib/admin-auth";
import { getPainelInicio, getPainelInicioMes } from "@/lib/painel-inicio";
import { getPainelInicioDono } from "@/lib/painel-inicio-dono";
import { isGeneralAdminAuth } from "@/lib/admin-profiles";
import { InicioCacheSaver } from "@/components/inicio/InicioDeviceCache";
import { INICIO_DAY_CACHE_NAME, INICIO_MONTH_CACHE_NAME, INICIO_OWNER_CACHE_NAME } from "@/components/panel-cache-names";
import PainelInicio, { InicioAssistente, InicioDono, InicioDonoCarregando, InicioFunil, InicioFunilCarregando, InicioFunilErro, InicioKpisMes, InicioKpisMesCarregando } from "@/components/inicio/PainelInicio";

export const dynamic = "force-dynamic";

// Início (pedido do dono, 2026-10-22 — docs/BUSINESS_RULES.md INI-1): resumo do dia de cada perfil, com os números
// reais no escopo dele (lib/painel-inicio.js). Não é a página de entrada do painel (o redirect atual não mudou), exceto no primeiro acesso do dia do dono (INI-4, components/FirstAccessGate.jsx) e na abertura do app/login do dono (INI-6, app/admin/abrir).
// O mês (funil, aprovados e vendas) é a mesma conta pesada do Desempenho: chega em seguida (streaming), sem segurar o resto.

// Uma única carga do mês, compartilhada pelos dois blocos que a mostram.
function loadMonth(auth) {
  return getPainelInicioMes(auth).then((month) => ({ ok: true, month })).catch((error) => {
    console.error("Início: falha ao carregar o funil do mês:", error?.message || error);
    return { ok: false, month: null };
  });
}

async function MonthKpis({ monthPromise }) {
  const { ok, month } = await monthPromise;
  return (
    <>
      <InicioKpisMes month={month} />
      {/* Guarda o mês para o próximo carregamento do Início (memória + aparelho, só desta conta). */}
      {ok && month ? <InicioCacheSaver name={INICIO_MONTH_CACHE_NAME} value={month} /> : null}
    </>
  );
}

async function MonthFunnel({ monthPromise }) {
  const { ok, month } = await monthPromise;
  return ok ? <InicioFunil month={month} /> : <InicioFunilErro />;
}

// Início do dono (INI-5): equipe + atenções (consultas pesadas) — uma carga, compartilhada pelo resumo e pelo detalhe.
function loadOwner(auth, data) {
  return getPainelInicioDono(auth, data).catch((error) => {
    console.error("Início: falha ao carregar a visão do dono:", error?.message || error);
    return null;
  });
}

async function OwnerSummary({ ownerPromise, data }) {
  const owner = await ownerPromise;
  return <InicioAssistente assistant={data.assistant} chatAvailable={data.chatAvailable} showActions={false} text={owner?.text ?? null} />;
}

async function OwnerDetail({ ownerPromise }) {
  const owner = await ownerPromise;
  return (
    <>
      <InicioDono owner={owner} />
      {owner ? <InicioCacheSaver name={INICIO_OWNER_CACHE_NAME} value={owner} /> : null}
    </>
  );
}

export default async function InicioPage() {
  const auth = await requireAdminPage();
  const monthPromise = loadMonth(auth);
  const data = await getPainelInicio(auth);
  const ownerPromise = isGeneralAdminAuth(auth) ? loadOwner(auth, data) : null;

  return (
    <main className="min-h-screen bg-mist pb-14 pt-3 md:pt-6">
      <PainelInicio
        data={data}
        monthKpis={<Suspense fallback={<InicioKpisMesCarregando />}><MonthKpis monthPromise={monthPromise} /></Suspense>}
        funnel={<Suspense fallback={<InicioFunilCarregando />}><MonthFunnel monthPromise={monthPromise} /></Suspense>}
        ownerSummary={ownerPromise ? (
          <Suspense fallback={<InicioAssistente assistant={data.assistant} chatAvailable={data.chatAvailable} showActions={false} />}>
            <OwnerSummary ownerPromise={ownerPromise} data={data} />
          </Suspense>
        ) : null}
        ownerDetail={ownerPromise ? <Suspense fallback={<InicioDonoCarregando />}><OwnerDetail ownerPromise={ownerPromise} /></Suspense> : null}
      />
      {/* Início que abre na hora (dono, 2026-10-26): o carregamento da tela mostra este último resumo desta conta. */}
      <InicioCacheSaver name={INICIO_DAY_CACHE_NAME} value={{ data, owner: Boolean(ownerPromise) }} />
    </main>
  );
}
