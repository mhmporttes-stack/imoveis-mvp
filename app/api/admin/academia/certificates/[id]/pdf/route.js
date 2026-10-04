import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { resolveAcademyActor } from "@/lib/academy-access-core.mjs";
import { buildCertificatePdf } from "@/lib/academy-certificate-pdf.mjs";
import { academyDisabledResponse, academyErrorResponse, academyManagementScope, getAcademyCertificates } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PDF do certificado. Aluno: só o próprio; Gerente: da equipe; Admin: qualquer. Fora do escopo = 404 (não revela que existe).
export async function GET(request, { params }) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Certificado não encontrado.", code: "certificate_not_found" }, { status: 404 });
  try {
    const certificates = getAcademyCertificates();
    if (!certificates) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    const cert = await certificates.getForDownload(resolveAcademyActor(auth), academyManagementScope(auth), id);
    const pdf = await buildCertificatePdf(cert);
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="certificado-${cert.code}.pdf"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return academyErrorResponse(error);
  }
}
