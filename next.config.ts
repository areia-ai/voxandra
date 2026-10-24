import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  images: {
    qualities: [75, 90],
  },
  async rewrites() {
    return { beforeFiles: [{ source: "/llms.txt", destination: "/markdown/home" }], afterFiles: [], fallback: [] };
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.voxandra.com" }],
        destination: "https://voxandra.com/:path*",
        permanent: true,
      },
      // Predictable guesses for "where are the developer resources". The MCP
      // server is the whole developer surface today (v1 is read-only by
      // product decision), so every conventional docs path lands there
      // rather than 404ing an agent that guessed a common URL.
      ...["/docs", "/developers", "/developer", "/api-docs", "/api"].map((source) => ({
        source,
        destination: "/mcp",
        permanent: false,
      })),
    ];
  },
};

export default nextConfig;
