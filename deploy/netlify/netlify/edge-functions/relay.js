export const config = {
  path: "/*",
};

const TARGET_BASE = (Netlify.env.get("TARGET_DOMAIN") || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function handler(request, context) {
  void context;

  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", {
      status: 500,
    });
  }

  try {
    const targetUrl = buildTargetUrl(request);
    const headers = buildForwardHeaders(request);
    const fetchOptions = buildFetchOptions(request, headers);

    const upstream = await fetch(targetUrl, fetchOptions);

    return buildRelayResponse(upstream);
  } catch (_error) {
    return new Response("Bad Gateway: Relay Failed", {
      status: 502,
    });
  }
}

function buildTargetUrl(request) {
  const url = new URL(request.url);
  return TARGET_BASE + url.pathname + url.search;
}

function buildForwardHeaders(request) {
  const headers = new Headers();
  let clientIp = null;

  for (const [key, value] of request.headers) {
    const normalizedKey = key.toLowerCase();

    if (shouldStripHeader(normalizedKey)) continue;

    if (normalizedKey === "x-real-ip") {
      clientIp = value;
      continue;
    }

    if (normalizedKey === "x-forwarded-for") {
      if (!clientIp) clientIp = value;
      continue;
    }

    headers.set(normalizedKey, value);
  }

  if (clientIp) {
    headers.set("x-forwarded-for", clientIp);
  }

  return headers;
}

function shouldStripHeader(headerName) {
  if (STRIP_HEADERS.has(headerName)) return true;
  if (headerName.startsWith("x-nf-")) return true;
  if (headerName.startsWith("x-netlify-")) return true;

  return false;
}

function buildFetchOptions(request, headers) {
  const method = request.method;

  const fetchOptions = {
    method,
    headers,
    redirect: "manual",
  };

  if (method !== "GET" && method !== "HEAD") {
    fetchOptions.body = request.body;
  }

  return fetchOptions;
}

function buildRelayResponse(upstream) {
  const responseHeaders = new Headers();

  for (const [key, value] of upstream.headers) {
    if (key.toLowerCase() === "transfer-encoding") continue;

    responseHeaders.set(key, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}