import { redirect } from "next/navigation";

export default function AdminServicesRedirect() {
  redirect("/admin/servers");
}
