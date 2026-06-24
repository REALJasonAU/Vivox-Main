import { redirect } from "next/navigation";

export default async function ServiceIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/services/${id}/overview`);
}
