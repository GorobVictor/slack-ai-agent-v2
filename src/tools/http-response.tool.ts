export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  return Response.json(body, {
    ...init,
    headers
  });
}

export function methodNotAllowedResponse(allowedMethods: string[]): Response {
  return jsonResponse(
    { error: "Method not allowed" },
    {
      status: 405,
      headers: {
        Allow: allowedMethods.join(", ")
      }
    }
  );
}

export function unauthorizedResponse(): Response {
  return jsonResponse({ error: "Unauthorized" }, { status: 401 });
}

export function notFoundResponse(): Response {
  return jsonResponse({ error: "Not found" }, { status: 404 });
}
