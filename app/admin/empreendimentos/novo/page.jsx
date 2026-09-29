import PropertyForm from "@/components/PropertyForm";
import { requireAdminPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";

export default async function NewDevelopmentPage() {
  const auth = await requireAdminPage();
  const canPublish = isGeneralAdminAuth(auth) || isManagerProfile(auth.profile);

  return (
    <main className="bg-mist py-14">
      <PropertyForm canPublish={canPublish} isDevelopment />
    </main>
  );
}
