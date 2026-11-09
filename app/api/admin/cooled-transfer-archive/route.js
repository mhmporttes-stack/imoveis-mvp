import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { viewerSeesCooledArchive } from "@/lib/cooled-archive-hidden";
import { getCooledTransferArchiveSettings, previewCooledTransferArchive, setCooledTransferArchiveEnabled } from "@/lib/cooled-transfer-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cliente frio transferido e sem retorno arquivado sozinho (FUN-15q, dono, 2026-11-09). SÓ o dono (conta real, fora de
// "Alterar conta"): GET = conferência somente leitura (quantos seriam arquivados agora + 20 primeiros, telefone
// mascarado) e estado do liga/desliga; POST { enabled } liga/desliga a rotina (nasce desligada).
async function requireOwner(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return { response: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (!viewerSeesCooledArchive(auth)) return { response: NextResponse.json({ error: "Apenas o dono acessa esta função." }, { status: 403 }) };
  return { auth };
}

export async function GET(request) {
  const { response } = await requireOwner(request);
  if (response) return response;
  try {
    const [settings, preview] = await Promise.all([getCooledTransferArchiveSettings(), previewCooledTransferArchive()]);
    return NextResponse.json({ ...settings, preview });
  } catch (error) {
    console.error("Falha na conferência do arquivamento de clientes frios:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível conferir agora." }, { status: 500 });
  }
}

export async function POST(request) {
  const { auth, response } = await requireOwner(request);
  if (response) return response;
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await setCooledTransferArchiveEnabled(auth, body?.enabled === true));
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível salvar." }, { status: error?.status || 500 });
  }
}
