import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * Guards against SSRF when fetching user-supplied media URLs server-side.
 * Only http(s) is allowed, and the host must resolve exclusively to public
 * (non-private, non-loopback, non-link-local) IP addresses.
 */
export async function assertSafeVideoUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Некорректная ссылка на видео");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Ссылка на видео должна начинаться с http:// или https://");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  // Resolve every address the host maps to and reject if any is non-public.
  let addresses: Array<{ address: string }>;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname }];
  } else {
    try {
      addresses = await lookup(hostname, { all: true });
    } catch {
      throw new Error("Не удалось определить адрес сервера видео");
    }
  }

  if (addresses.length === 0) {
    throw new Error("Не удалось определить адрес сервера видео");
  }

  for (const { address } of addresses) {
    if (!isPublicAddress(address)) {
      throw new Error("Доступ к этому адресу запрещён");
    }
  }
}

function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return isPublicIPv4(ip);
  }
  if (net.isIPv6(ip)) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — validate the embedded IPv4.
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) {
      return isPublicIPv4(mapped[1]);
    }
    return isPublicIPv6(ip);
  }
  return false;
}

function isPublicIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;

  if (a === 0) return false; // 0.0.0.0/8
  if (a === 10) return false; // private
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 192 && b === 0) return false; // 192.0.0.0/24 (IETF)
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast / reserved

  return true;
}

function isPublicIPv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === "::1" || addr === "::") return false; // loopback / unspecified
  if (addr.startsWith("fe80")) return false; // link-local
  if (addr.startsWith("fc") || addr.startsWith("fd")) return false; // unique local (fc00::/7)
  return true;
}
