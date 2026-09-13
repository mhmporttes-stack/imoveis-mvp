import { notFound } from "next/navigation";
import ClientJourney from "@/components/ClientJourney";
import { getPublicJourney } from "@/lib/client-journey";
export const dynamic = "force-dynamic";
export const metadata = { title: "Minha Jornada", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const viewport = { width: "device-width", initialScale: 1, maximumScale: 5, userScalable: true, themeColor: "#ffffff" };
export default async function Page({ params }) {
  const data = await getPublicJourney((await params).token);
  if (!data) notFound();
  return <ClientJourney data={data} />;
}
