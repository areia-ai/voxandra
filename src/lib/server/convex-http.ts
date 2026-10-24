import { ConvexHttpClient } from "convex/browser";

export function getServerEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function getServerConvexClient() {
  return new ConvexHttpClient(getServerEnv("NEXT_PUBLIC_CONVEX_URL"));
}
