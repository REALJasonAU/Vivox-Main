import { redirect } from "next/navigation";

export default function CustomersRedirectPage() {
  redirect("/admin/users");
}
