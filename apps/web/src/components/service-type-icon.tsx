"use client";

import type { Service, ServiceType } from "@/lib/types";
import { isMinecraftGame, isRustGame } from "@/lib/game-service";
import {
  DockerLogo,
  MinecraftLogo,
  PostgresLogo,
  RustLogo,
  StaticSiteLogo,
} from "@/components/service-logos";
import { cn } from "@/lib/utils";

export function getServiceKindLabel(service: Service): string {
  if (isRustGame(service)) return "Rust";
  if (isMinecraftGame(service)) return "Minecraft";
  switch (service.type) {
    case "database":
      return "Database";
    case "static":
      return "Static Site";
    case "docker":
      return "Docker App";
    default:
      return "Game Server";
  }
}

export function ServiceTypeIcon({
  service,
  className,
}: {
  service: Service;
  className?: string;
}) {
  if (isRustGame(service)) {
    return <RustLogo className={className} />;
  }
  if (isMinecraftGame(service)) {
    return <MinecraftLogo className={className} />;
  }
  return <GenericServiceIcon type={service.type} className={className} />;
}

function GenericServiceIcon({
  type,
  className,
}: {
  type: ServiceType;
  className?: string;
}) {
  switch (type) {
    case "database":
      return <PostgresLogo className={className} />;
    case "static":
      return <StaticSiteLogo className={className} />;
    default:
      return <DockerLogo className={className} />;
  }
}

export function ServiceIconBadge({
  service,
  size = "md",
}: {
  service: Service;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "size-8 rounded-lg" : "size-11 rounded-xl";
  const iconCls = size === "sm" ? "size-4" : "size-6";
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center border border-border bg-surface-raised",
        box,
        isRustGame(service) && "border-[#CE422B]/25 bg-[#CE422B]/10",
        isMinecraftGame(service) && "border-[#5D8C3E]/25 bg-[#5D8C3E]/10",
      )}
    >
      <ServiceTypeIcon service={service} className={iconCls} />
    </span>
  );
}
