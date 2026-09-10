"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { persistCampaignId } from "@/lib/campaign-link-client";

function CampaignLinkCaptureInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  useEffect(() => {
    const campaignId = searchParams?.get("c") || "";
    if (campaignId) persistCampaignId(campaignId);
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
