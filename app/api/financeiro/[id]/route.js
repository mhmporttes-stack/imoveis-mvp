import { NextResponse } from "next/server";
import { requirePrimaryAdminApi } from "@/lib/admin-auth";
import {
  canManageFinancial,
  deleteFinancialSale,
  formatFinancialError,
  getFinancialSale,
  updateFinancialSale
} from "@/lib/financial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const auth = await requirePrimaryAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageFinancial()) {
    return NextResponse.json({ error: "Supabase administrativo nao configurado para gerenciar o financeiro." }, { status: 503 });
  }

  try {
    const sale = await getFinancialSale((await params).id);
    if (!sale) {
      return NextResponse.json({ error: "Venda financeira nao encontrada." }, { status: 404 });
    }
    return NextResponse.json(sale);
  } catch (error) {
    return NextResponse.json({ error: formatFinancialError(error) }, { status: 400 });
  }
}

export async function PATCH(request, { params }) {
  const auth = await requirePrimaryAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageFinancial()) {
    return NextResponse.json({ error: "Supabase administrativo nao configurado para gerenciar o financeiro." }, { status: 503 });
  }

  try {
    const body = await request.json();
    const sale = await updateFinancialSale((await params).id, body, auth.user?.email);
    return NextResponse.json(sale);
  } catch (error) {
    return NextResponse.json({ error: formatFinancialError(error) }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requirePrimaryAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!canManageFinancial()) {
    return NextResponse.json({ error: "Supabase administrativo nao configurado para gerenciar o financeiro." }, { status: 503 });
  }

  try {
    await deleteFinancialSale((await params).id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: formatFinancialError(error) }, { status: 400 });
  }
}
