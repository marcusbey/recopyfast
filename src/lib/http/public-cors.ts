import { NextRequest, NextResponse } from "next/server";

export function withPublicCors(
  response: NextResponse,
  requestOrOrigin: NextRequest | string | null,
  methods = "GET,POST,PUT,OPTIONS",
) {
  const origin =
    typeof requestOrOrigin === "string"
      ? requestOrOrigin
      : requestOrOrigin?.headers.get("origin");
  const fallbackOrigin =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  response.headers.set("Access-Control-Allow-Origin", origin || fallbackOrigin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type",
  );
  response.headers.set("Access-Control-Allow-Methods", methods);
  response.headers.set("Vary", "Origin");
  return response;
}

export function publicOptions(
  request: NextRequest,
  methods = "GET,POST,PUT,OPTIONS",
) {
  return withPublicCors(
    NextResponse.json({}, { status: 204 }),
    request,
    methods,
  );
}
