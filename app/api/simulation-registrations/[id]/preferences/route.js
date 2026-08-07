import { NextResponse } from "next/server";
import { PropertyPreferencesValidationError } from "@/lib/property-preferences";
import {
  canManageSimulationRegistrations,
  formatSimulationRegistrationError,
  updateSimulationRegistrationPreferences
} from "@/lib/simulation-registrations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request, { params }) {
  if (!canManageSimulationRegistrations()) {
    return NextResponse.json(
      { error: "NÃ£o foi possÃ­vel salvar suas preferÃªncias agora. Tente novamente em alguns instantes." },
      { status: 503 }
    );
  }

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Envie respostas vÃ¡lidas para continuar." }, { status: 400 });
  }

  try {
    const { id } = await params;
    const registration = await updateSimulationRegistrationPreferences(id, payload);
    return NextResponse.json({ ok: true, registration });
  } catch (error) {
    if (error instanceof PropertyPreferencesValidationError) {
      return NextResponse.json(
        {
          error: "Revise suas preferÃªncias antes de continuar.",
          fieldErrors: error.fieldErrors
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error:
          formatSimulationRegistrationError(error) ||
          "NÃ£o foi possÃ­vel salvar suas preferÃªncias agora. Verifique sua conexÃ£o e tente novamente."
      },
      { status: 400 }
    );
  }
}
