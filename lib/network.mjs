import { networkInterfaces } from "node:os";
import { execFileSync } from "node:child_process";

export function localNetworkName() {
  if (process.platform !== "darwin") return "";
  try {
    const name = execFileSync("/usr/sbin/scutil", ["--get", "LocalHostName"], {
      encoding: "utf8",
      timeout: 1000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .toLowerCase();
    return /^[a-z0-9][a-z0-9-]*$/.test(name) ? `${name}.local` : "";
  } catch {
    return "";
  }
}

export function serverHost(args) {
  if (!args.length) return "127.0.0.1";
  if (args[0] === "--host" && args.length === 1) return "0.0.0.0";
  const host =
    args[0] === "--host" && args.length === 2
      ? args[1]
      : args.length === 1 && args[0].startsWith("--host=")
        ? args[0].slice(7)
        : "";
  if (!host || !/^[a-zA-Z0-9.:_-]+$/.test(host) || host.startsWith("-"))
    throw new Error("Usage: node server.mjs [--host [address]]");
  return host;
}

export function allowedAuthorities(host, port, localName = localNetworkName()) {
  const hosts = new Set(["127.0.0.1", "localhost"]);
  if (host === "0.0.0.0" || host === "::") {
    if (/^[a-z0-9][a-z0-9-]*\.local$/i.test(localName))
      hosts.add(localName.toLowerCase());
    for (const addresses of Object.values(networkInterfaces()))
      for (const { address, family } of addresses || [])
        if (family === "IPv4" || (host === "::" && !address.includes("%")))
          hosts.add(address);
  } else hosts.add(host.toLowerCase());
  return new Set(
    [...hosts].map(
      (address) =>
        `${address.includes(":") ? `[${address}]` : address}:${port}`,
    ),
  );
}
