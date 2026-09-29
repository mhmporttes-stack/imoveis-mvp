import TestimonialForm from "@/components/TestimonialForm";
import { requireAdminPage } from "@/lib/admin-auth";
import { isGeneralAdminAuth, isManagerProfile } from "@/lib/admin-profiles";

export default async function NewTestimonialPage() {
  const auth = await requireAdminPage();
  const canPublish = isGeneralAdminAuth(auth) || isManagerProfile(auth.profile);

  return (
    <main className="bg-mist py-14">
      <TestimonialForm canPublish={canPublish} />
    </main>
  );
}
