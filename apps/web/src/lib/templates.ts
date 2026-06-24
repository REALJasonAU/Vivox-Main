import type { DeployTemplate } from "./types";

/** Phase 1 starter templates (plan section 9) — all Docker-backed. */
export const DEPLOY_TEMPLATES: DeployTemplate[] = [
  {
    id: "minecraft",
    name: "Minecraft Server",
    type: "game",
    description: "itzg/minecraft-server with configurable RAM and EULA.",
    defaultImage: "itzg/minecraft-server:latest",
    defaultPorts: ["25565:25565"],
    env: [
      { key: "EULA", label: "Accept EULA", value: "TRUE", required: true },
      { key: "MEMORY", label: "Memory", value: "2G" },
      { key: "VERSION", label: "Version", value: "LATEST" },
      { key: "TYPE", label: "Server Type", value: "VANILLA" },
    ],
  },
  {
    id: "docker",
    name: "Generic Docker App",
    type: "docker",
    description: "Run any public image with custom ports and environment.",
    defaultImage: "",
    defaultPorts: ["8080:80"],
    env: [],
  },
  {
    id: "static",
    name: "Static Site",
    type: "static",
    description: "nginx serving uploaded static files.",
    defaultImage: "nginx:alpine",
    defaultPorts: ["80:80"],
    env: [],
  },
];

export const REGIONS = [
  { id: "au-1", label: "Australia (Sydney)" },
  { id: "us-east-1", label: "US East (Virginia)" },
  { id: "eu-west-1", label: "EU West (Ireland)" },
  { id: "ap-south-1", label: "Asia Pacific (Singapore)" },
];

export function getTemplate(id: string): DeployTemplate | undefined {
  return DEPLOY_TEMPLATES.find((t) => t.id === id);
}
