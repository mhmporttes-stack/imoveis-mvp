import { NextResponse } from "next/server";
import {
  canManageSimulationRegistrations,
  createSimulationRegistration,
  formatSimulationRegistrationError,
  SimulationRegistrationValidationError
} from "@/lib/simulation-registrations";
import { sendSimulationRegistrationNotification } from "@/lib/simulation-registration-notifications";

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

  try {
    const registration = await createSimulationRegistration(payload);
    try {
      const notification = await sendSimulationRegistrationNotification(registration);
      if (notification?.skipped) {
        console.warn("Simulation notification email skipped:", notification.reason);
      }
    } catch (notificationError) {
      console.warn("Simulation notification email failed:", notificationError?.message || notificationError);
    }
    return NextResponse.json({ ok: true }, { status: 201 });
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
