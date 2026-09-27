const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_endpoint");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("invalid_endpoint");
  }

  const isSecure = url.protocol === "https:";
  const isLocalDevelopment =
    url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (!isSecure && !isLocalDevelopment) {
    throw new Error("insecure_endpoint");
  }

  return url.toString().replace(/\/+$/, "");
}
