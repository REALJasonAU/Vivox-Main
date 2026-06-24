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
    defaultMemoryMb: 2048,
    defaultCpuThreads: 1,
    defaultDiskGb: 10,
    env: [
      {
        key: "EULA",
        label: "Accept EULA",
        value: "TRUE",
        required: true,
        description: "Must be TRUE to run the official Minecraft server image.",
        options: "TRUE",
      },
      {
        key: "MEMORY",
        label: "JVM heap",
        value: "2G",
        description: "Java heap passed to the server process.",
        options: "1G, 2G, 4G, 8G",
      },
      {
        key: "VERSION",
        label: "Minecraft version",
        value: "LATEST",
        description: "Release tag or LATEST for newest.",
        options: "LATEST, 1.21.1, 1.20.4",
      },
      {
        key: "TYPE",
        label: "Server type",
        value: "VANILLA",
        description: "Server flavour / mod loader.",
        options: "VANILLA, PAPER, FORGE, FABRIC",
      },
    ],
  },
  {
    id: "docker",
    name: "Generic Docker App",
    type: "docker",
    description: "Run any public image with custom ports and environment.",
    defaultImage: "",
    defaultPorts: [],
    defaultMemoryMb: 512,
    defaultCpuThreads: 1,
    defaultDiskGb: 5,
    env: [],
  },
  {
    id: "static",
    name: "Static Site",
    type: "static",
    description: "nginx serving uploaded static files.",
    defaultImage: "nginx:alpine",
    defaultPorts: ["8080:80/tcp"],
    defaultMemoryMb: 256,
    defaultCpuThreads: 1,
    defaultDiskGb: 2,
    env: [],
  },
];

export function getTemplate(id: string): DeployTemplate | undefined {
  return DEPLOY_TEMPLATES.find((t) => t.id === id);
}
