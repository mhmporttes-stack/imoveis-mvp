import { NextResponse } from "next/server";
import {
  canManageSimulationRegistrations,
  createSimulationRegistration,
  formatSimulationRegistrationError,
  SimulationRegistrationValidationError
} from "@/lib/simulation-registrations";
import { sendSimulationRegistrationNotification } from "@/lib/simulation-registration-notifications";
import { createPendingSimulationFromRegistration } from "@/lib/simulations";
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
    try {
      await createPendingSimulationFromRegistration(registration);
    } catch (simulationError) {
      console.warn("Pending simulation creation failed:", simulationError?.message || simulationError);
    }

    try {
      const notification = await sendSimulationRegistrationNotification(registration);
      if (notification?.skipped) {
        console.warn("Simulation notification email skipped:", notification.reason);
      }
    } catch (notificationError) {
      console.warn("Simulation notification email failed:", notificationError?.message || notificationError);
    }
    return NextResponse.json(
      {
        ok: true,
        registrationId: registration.id,
        preferencesAccessToken: registration.preferencesAccessToken || ""
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
