"use client";

import { ServiceDetailPage } from "@/components/service-detail-page";

export function ServiceDetailClient({
  serviceId,
  segments,
}: {
  serviceId: string;
  segments: string[];
}) {
  return <ServiceDetailPage serviceId={serviceId} segments={segments} />;
}
