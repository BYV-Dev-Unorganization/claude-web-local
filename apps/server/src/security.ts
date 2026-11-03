import path from "node:path";
import fs from "node:fs/promises";
import dns from "node:dns/promises";
import net from "node:net";
import { config } from "./config.js";

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === "::" || normalized === "::1" ||
    normalized.startsWith("fc") || normalized.startsWith("fd") ||
    normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb") ||
    normalized.startsWith("ff") || normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !isPrivateIpv4(address);
  if (family === 6) return !isPrivateIpv6(address);
  return false;
}

export async function assertPublicHttpUrl(input: string): Promise<URL> {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS URLs are allowed.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local hostnames are blocked by network policy.");
  }
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new Error("Private or reserved IP addresses are blocked.");
  } else {
    const addresses = await dns.lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
      throw new Error("The hostname resolves to a private or reserved address.");
    }
  }
  return url;
}

export async function resolveWorkspacePath(relativePath: string, mustExist = false): Promise<string> {
  if (path.isAbsolute(relativePath)) throw new Error("Absolute paths are not allowed.");
  const root = await fs.realpath(config.workspacePath);
  const candidate = path.resolve(root, relativePath);
  const rel = path.relative(root, candidate);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Path escapes the selected workspace root.");
  if (mustExist) {
    const real = await fs.realpath(candidate);
    const verified = path.relative(root, real);
    if (!verified || verified.startsWith("..") || path.isAbsolute(verified)) throw new Error("Symlink escape is not allowed.");
    return real;
  }
  const parent = await fs.realpath(path.dirname(candidate));
  const verifiedParent = path.relative(root, parent);
  if (!verifiedParent && parent !== root) throw new Error("Invalid workspace path.");
  if (verifiedParent.startsWith("..") || path.isAbsolute(verifiedParent)) throw new Error("Symlink escape is not allowed.");
  return candidate;
}
