"use client";

import { use } from "react";
import { ServiceDetailPage } from "@/components/service-detail-page";

export default function ServiceDetailRoute({
  params,
}: {
  params: Promise<{ id: string; segments?: string[] }>;
}) {
  const { id, segments } = use(params);
  return <ServiceDetailPage serviceId={id} segments={segments} />;
}
