import { NextResponse } from "next/server";
import {
  canManageSimulationRegistrations,
  createSimulationRegistration,
  formatSimulationRegistrationError,
  markRegistrationAutoSimulation,
  SimulationRegistrationValidationError
} from "@/lib/simulation-registrations";
import { sendSimulationRegistrationNotification } from "@/lib/simulation-registration-notifications";
import { announceAlexaEvent } from "@/lib/alexa-service";
import { saveSiteSimulationFromRegistration } from "@/lib/simulations";
import { scheduleAutoSimulationSend } from "@/lib/simulation-auto-send";
import { saveAutoSnapshot } from "@/lib/simulation-auto-reviews";
import { buildAutoSnapshot } from "@/lib/simulation-auto-review-core.mjs";
import { recordScenario } from "@/lib/simulation-scenarios";
import { scenarioDataFromSimulation } from "@/lib/simulation-scenarios-core.mjs";
import { extractRequestMetadata } from "@/lib/meta-conversions-api";
import { buildRateLimitKey, checkPublicRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  if (!canManageSimulationRegistrations()) {
    return NextResponse.json(
      { error: "Não foi possível enviar seus dados agora. Tente novamente em alguns instantes." },
      { status: 503 }
    );
  }

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Envie respostas válidas para continuar." }, { status: 400 });
  }

  const allowed = await checkPublicRateLimit(buildRateLimitKey(request, payload?.phone), { windowSeconds: 60, maxAttempts: 3 });
  if (!allowed) {
    return NextResponse.json({ error: "Aguarde alguns instantes antes de enviar novamente." }, { status: 429 });
  }

  try {
    const registration = await createSimulationRegistration(payload, extractRequestMetadata(request));
    // SIM-AUTO (dono, 2026-10-19): elegível ao MCMV → simulação automática gravada (novo + usado), status "Simulação
    // automática" e retrato para a conferência (que não trava mais o link desde 2026-10-23). Fora do MCMV: a vazia de sempre.
    // SIM-AUTO-ENVIO (dono, 2026-10-23): cadastro NOVO com simulação automática é programado para o envio automático do
    // link (cron whatsapp-flows, lib/simulation-auto-send.js). Só daqui para frente: nada retroativo.
    // Falha aqui nunca derruba o cadastro (mesmo tratamento da simulação vazia de antes).
    try {
      const saved = await saveSiteSimulationFromRegistration(registration);
      // Sem dado pessoal no log: só o id do cadastro e o motivo.
      if (saved.skipped) console.warn("Site automatic simulation skipped:", saved.skipped, registration.id);
      if (saved.automatic && saved.simulation?.id) {
        await markRegistrationAutoSimulation(registration.id);
        const snapshot = buildAutoSnapshot(registration, saved.estimate, saved.referenceDate);
        await saveAutoSnapshot({ registrationId: registration.id, simulationId: saved.simulation.id, snapshot });
        // Cenário para "Comparar simulações" (nunca derruba o cadastro).
        await recordScenario({ registrationId: registration.id, simulationId: saved.simulation.id, origin: "site", data: { ...scenarioDataFromSimulation(saved.simulation, { registration, estimate: saved.estimate }), autoSnapshot: snapshot } });
        if (registration.isNewRegistration !== false) await scheduleAutoSimulationSend(registration.id);
      }
    } catch (simulationError) {
      console.warn("Site simulation creation failed:", simulationError?.message || simulationError);
    }

    try {
      const notification = await sendSimulationRegistrationNotification(registration);
      if (notification?.skipped) {
        console.warn("Simulation notification email skipped:", notification.reason);
      }
    } catch (notificationError) {
      console.warn("Simulation notification email failed:", notificationError?.message || notificationError);
    }
    await announceAlexaEvent("new_client", { clienteNome: registration.fullName, responsibleUserId: registration.responsibleUserId });
    return NextResponse.json(
      {
        ok: true,
        registrationId: registration.id,
        preferencesAccessToken: registration.preferencesAccessToken || "",
        isNewRegistration: registration.isNewRegistration !== false
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof SimulationRegistrationValidationError) {
      return NextResponse.json(
        {
          error: "Revise as informações preenchidas antes de enviar.",
          fieldErrors: error.fieldErrors
        },
        { status: 400 }
      );
    }

    console.error("Simulation registration failed:", error?.message || error);
    return NextResponse.json(
      { error: formatSimulationRegistrationError(error) },
      { status: 400 }
    );
  }
}
