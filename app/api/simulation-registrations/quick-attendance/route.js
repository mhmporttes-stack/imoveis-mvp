import { NextResponse } from "next/server";
import {
  canManageSimulationRegistrations,
  createQuickAttendanceRegistration,
  formatSimulationRegistrationError
} from "@/lib/simulation-registrations";
import { sendSimulationRegistrationNotification } from "@/lib/simulation-registration-notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Mesmo contrato de app/api/simulation-registrations/route.js (formulário
// completo), só que para a jornada "Atendimento Rápido": cria um cliente
// normal do CRM (nunca uma entidade paralela) com o mínimo de campos, e
// dispara a mesma notificação de novo lead externo. Não cria uma "simulação
// pendente" vinculada — essa jornada não coleta nenhum dado financeiro, não
// haveria nada para simular.
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
    const registration = await createQuickAttendanceRegistration(payload);

    try {
      const notification = await sendSimulationRegistrationNotification(registration);
      if (notification?.skipped) {
        console.warn("Quick attendance notification email skipped:", notification.reason);
      }
    } catch (notificationError) {
      console.warn("Quick attendance notification email failed:", notificationError?.message || notificationError);
    }

    return NextResponse.json(
      { ok: true, registrationId: registration.id, contactPreference: registration.contactPreference },
      { status: 201 }
    );
  } catch (error) {
    console.error("Quick attendance registration failed:", error?.message || error);
    return NextResponse.json(
      { error: formatSimulationRegistrationError(error) },
      { status: 400 }
    );
  }
}
