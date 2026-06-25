import { redirect } from "next/navigation";
import { ServiceDetailClient } from "./service-detail-client";

export default async function ServiceDetailRoute({
  params,
}: {
  params: Promise<{ id: string; segments?: string[] }>;
}) {
  const { id, segments } = await params;

  if (!segments?.length) {
    redirect(`/services/${id}/overview`);
  }

  return <ServiceDetailClient serviceId={id} segments={segments} />;
}
