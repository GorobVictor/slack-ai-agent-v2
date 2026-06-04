import {
  jsonResponse,
  methodNotAllowedResponse,
  notFoundResponse,
} from "../../tools/http-response.tool";

const SOCKET_SESSION_NAME = "default";

export async function handleSlackSocketRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowedResponse(["POST"]);
  }

  const path = new URL(request.url).pathname;
  const session = env.SLACK_SOCKET_SESSION.getByName(SOCKET_SESSION_NAME);

  if (path === "/slack/socket/connect") {
    return jsonResponse(await session.openSlackSocket());
  }

  if (path === "/slack/socket/disconnect") {
    return jsonResponse(await session.closeSlackSocket());
  }

  return notFoundResponse();
}
