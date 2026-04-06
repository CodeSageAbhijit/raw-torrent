import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_PREFIX = "/api/torrent";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

const getBackendBaseUrl = () => {
  const internal = process.env.BACKEND_URL?.trim();
  if (internal) {
    return internal.replace(/\/$/, "");
  }

  const publicBackend = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL?.trim();
  if (publicBackend && /^https?:\/\//i.test(publicBackend)) {
    return publicBackend.replace(/\/$/, "");
  }

  return "http://localhost:4000";
};

const buildTargetUrl = (request: NextRequest) => {
  const suffix = request.nextUrl.pathname.startsWith(API_PREFIX)
    ? request.nextUrl.pathname.slice(API_PREFIX.length)
    : "";

  const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${getBackendBaseUrl()}/torrent${normalizedSuffix}${request.nextUrl.search}`;
};

const buildForwardHeaders = (request: NextRequest) => {
  const headers = new Headers();

  for (const [key, value] of request.headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }

    headers.set(key, value);
  }

  const host = request.headers.get("host");
  if (host) {
    headers.set("x-forwarded-host", host);
  }

  const forwardedProto = request.nextUrl.protocol.replace(":", "");
  if (forwardedProto) {
    headers.set("x-forwarded-proto", forwardedProto);
  }

  return headers;
};

const proxyRequest = async (request: NextRequest) => {
  const targetUrl = buildTargetUrl(request);
  const method = request.method.toUpperCase();

  try {
    const init: RequestInit = {
      method,
      headers: buildForwardHeaders(request),
      redirect: "manual",
      cache: "no-store",
    };

    if (method !== "GET" && method !== "HEAD") {
      const body = await request.arrayBuffer();
      if (body.byteLength > 0) {
        init.body = body;
      }
    }

    const response = await fetch(targetUrl, init);
    const headers = new Headers(response.headers);
    for (const header of HOP_BY_HOP_HEADERS) {
      headers.delete(header);
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy request failed";
    return NextResponse.json(
      {
        success: false,
        error: message,
        targetUrl,
      },
      { status: 502 }
    );
  }
};

export async function GET(request: NextRequest) {
  return proxyRequest(request);
}

export async function POST(request: NextRequest) {
  return proxyRequest(request);
}

export async function PUT(request: NextRequest) {
  return proxyRequest(request);
}

export async function PATCH(request: NextRequest) {
  return proxyRequest(request);
}

export async function DELETE(request: NextRequest) {
  return proxyRequest(request);
}

export async function HEAD(request: NextRequest) {
  return proxyRequest(request);
}
