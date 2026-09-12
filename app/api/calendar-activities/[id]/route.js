import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { completeCalendarActivity, createLegacyRescheduleHistory, deleteCalendarActivity, rescheduleCalendarActivity } from "@/lib/calendar-activities";
import { getSimulationRegistration, updateSimulationRegistration } from "@/lib/simulation-registrations";

export async function PATCH(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const id = (await params).id;
    if (body.source === "legacy") {
      if (body.action === "complete") {
        const activity = await updateSimulationRegistration(id, { scheduledActivityCompleted: true }, auth);
        return NextResponse.json({ activity: legacyActivity(activity) });
      }
      if (body.action === "reschedule") {
        const current = await getSimulationRegistration(id, auth);
        const previous = await createLegacyRescheduleHistory(current, body.scheduledAt, auth);
        const updated = await updateSimulationRegistration(id, { scheduledActivityAt: body.scheduledAt, scheduledActivityNote: body.note }, auth);
        return NextResponse.json({ previous, next: legacyActivity(updated) });
      }
    }
    if (body.action === "complete") return NextResponse.json({ activity: await completeCalendarActivity(id, auth) });
    if (body.action === "reschedule") return NextResponse.json(await rescheduleCalendarActivity(id, body.scheduledAt, body.note, auth));
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível atualizar a atividade." }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const id = (await params).id;
    return NextResponse.json(await deleteCalendarActivity(id, auth));
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível cancelar a atividade." }, { status: 400 });
  }
}

function legacyActivity(registration) {
  return {
    id: registration.id,
    clientId: registration.id,
    source: "legacy",
    clientName: registration.fullName,
    phone: registration.phone,
    scheduledActivityAt: registration.scheduledActivityAt,
    scheduledActivityType: registration.scheduledActivityType,
    scheduledActivityNote: registration.scheduledActivityNote,
    scheduledActivityCompletedAt: registration.scheduledActivityCompletedAt,
    scheduledActivityCompleted: Boolean(registration.scheduledActivityCompletedAt),
    responsibleUserId: registration.responsibleUserId
  };
}
