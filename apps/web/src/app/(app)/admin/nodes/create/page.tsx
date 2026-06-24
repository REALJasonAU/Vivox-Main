"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { RegisterNodeForm } from "@/components/register-node-form";
import { NodeSetupPanel } from "@/components/NodeSetupPanel";
import { EmptyState } from "@/components/ui/states";
import { useSession } from "@/lib/auth-client";
import type { Node } from "@/lib/types";

export default function CreateNodePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === undefined || role === "admin";
  const [setup, setSetup] = useState<{ node: Node; token: string } | null>(null);

  if (!isAdmin) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-6" />}
        title="Admin access required"
        description="Node management is restricted to administrators."
      />
    );
  }

  if (setup) {
    return (
      <NodeSetupPanel
        node={setup.node}
        token={setup.token}
        onClose={() => router.push("/admin/nodes")}
      />
    );
  }

  return <RegisterNodeForm onRegistered={(node, token) => setSetup({ node, token })} />;
}
