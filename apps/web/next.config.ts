import type { NextConfig } from "next";

const apiUrl =
  process.env.API_URL ??
  process.env.API_INTERNAL_URL ??
  "http://localhost:8080";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/control/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
