"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { persistCampaignId } from "@/lib/campaign-link-client";
import { persistAdAttribution } from "@/lib/ad-click-attribution.mjs";

function CampaignLinkCaptureInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  useEffect(() => {
    const campaignId = searchParams?.get("c") || "";
    if (campaignId) persistCampaignId(campaignId);
    // UTM + gclid/gbraid/wbraid do anúncio (Google Ads): guardados 90 dias para o cadastro, mesmo depois de navegar.
    persistAdAttribution(searchParams);
  }, [searchParams, pathname]);

  return null;
}

export default function CampaignLinkCapture() {
  return (
    <Suspense fallback={null}>
      <CampaignLinkCaptureInner />
    </Suspense>
  );
}
