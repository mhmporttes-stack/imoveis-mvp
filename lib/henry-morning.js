import "server-only";
import { getSupabaseAdminClient } from "./supabase";
import { applyResponsibleUserScope } from "./admin-access";
import { addDaysToPlainDate, getTodayInSaoPaulo, zonedPlainDateToUtcIso } from "./daily-report";
import { listBirthdayRegistrations } from "./simulation-registrations";
import { birthdayFirstNames } from "./alexa-config-core.mjs";
import { firstNameOf } from "./alexa-v2/text.mjs";
import { AUTOMATIC_SIMULATION_SOURCE } from "./simulation-status-lock-core.mjs";
import { countAutoSimulationSendsSince } from "./simulation-auto-send";

// Números extras do "bom dia" do Henry (dono, 2026-10-23; HENRY-1). Somente leitura, escopo do perfil (dono = tudo).
// - Clientes novos desde ontem: cadastros em `simulation_registrations` criados desde 00h de ontem (Brasília) — a mesma
//   contagem do "leads de hoje" do Início (loadLeadsToday, lib/painel-inicio.js), com a janela começando ontem.
// - Simulação automática: desses cadastros, quantos têm linha em `simulations` com created_by = "Simulação automática do
//   site" (AUTOMATIC_SIMULATION_SOURCE). É GERADA e mostrada no site.
// - Simulações ENVIADAS automaticamente desde 00h de ontem (SIM-AUTO-ENVIO, dono 2026-10-23): countAutoSimulationSendsSince
//   (lib/simulation-auto-send.js, eventos "simulation_auto_sent"); só esta contagem permite dizer "enviei".
// - Aniversariantes de hoje: mesma fonte e escopo da Agenda e da Alexa (listBirthdayRegistrations com o responsável = dono;
//   data = oldest_birth_date, ano 1900 = sem data); só primeiros nomes.
// Cada leitura falha sozinha (null / lista vazia, com o motivo no log) — nunca um zero falso.

const ID_CHUNK = 200;

function db() {
  const client = getSupabaseAdminClient();
  if (!client) throw new Error("Supabase administrativo não configurado.");
  return client;
}

async function loadNewClientIds(auth, sinceIso) {
  const { data, error } = await applyResponsibleUserScope(db().from("simulation_registrations").select("id").gte("created_at", sinceIso).limit(2000), auth);
  if (error) throw error;
  return (data || []).map((row) => row.id).filter(Boolean);
}

async function countAutoSimulations(ids) {
  const withAuto = new Set();
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const { data, error } = await db()
      .from("simulations")
      .select("registration_id")
      .in("registration_id", ids.slice(index, index + ID_CHUNK))
      .eq("created_by", AUTOMATIC_SIMULATION_SOURCE);
    if (error) throw error;
    for (const row of data || []) if (row.registration_id) withAuto.add(row.registration_id);
  }
  return withAuto.size;
}

export async function loadHenryMorningExtras(auth) {
  const today = getTodayInSaoPaulo();
  const sinceIso = zonedPlainDateToUtcIso(addDaysToPlainDate(today, -1));
  const clients = loadNewClientIds(auth, sinceIso).catch((error) => {
    console.warn(`[henry] bom dia: clientes novos indisponíveis (${error?.code || error?.name || "erro"}).`);
    return null;
  });
  const birthdays = listBirthdayRegistrations({ auth, responsibleUserId: auth?.profile?.id })
    .then((rows) => birthdayFirstNames(rows, today, firstNameOf))
    .catch((error) => {
      console.warn(`[henry] bom dia: aniversariantes indisponíveis (${error?.code || error?.name || "erro"}).`);
      return [];
    });
  const ids = await clients;
  const autoSimulations = ids
    ? ids.length
      ? await countAutoSimulations(ids).catch((error) => {
          console.warn(`[henry] bom dia: simulações automáticas indisponíveis (${error?.code || error?.name || "erro"}).`);
          return null;
        })
      : 0
    : null;
  const autoSimulationSends = await countAutoSimulationSendsSince(sinceIso).catch((error) => {
    console.warn(`[henry] bom dia: simulações enviadas indisponíveis (${error?.code || error?.name || "erro"}).`);
    return null;
  });
  return { newClients: ids ? ids.length : null, autoSimulations, autoSimulationSends, birthdays: await birthdays };
}
