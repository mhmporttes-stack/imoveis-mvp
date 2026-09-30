import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PropertyForm from "@/components/PropertyForm";
import { requireAdminPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";

export default async function NewDevelopmentPage() {
  const auth = await requireAdminPage();
  const canPublish = isGeneralAdminAuth(auth) || isManagerProfile(auth.profile);

  return (
    <main className="bg-mist py-14">
      <section className="container-page mb-8">
        <Link href="/admin?area=gestao" className="inline-flex items-center gap-2 text-sm font-black text-brand transition hover:text-navy">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para empreendimentos
        </Link>
      </section>
      <PropertyForm canPublish={canPublish} isDevelopment />
    </main>
  );
}
