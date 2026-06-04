import { handleSlackSocketRequest } from "./modules/slack/slack.handler";
import { SlackSocketSession } from "./modules/slack/slack-socket-session";
import { jsonResponse, notFoundResponse } from "./tools/http-response.tool";

export { SlackSocketSession };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "slack-ai-agent-v2" });
    }

    if (url.pathname.startsWith("/slack/socket/")) {
      return handleSlackSocketRequest(request, env);
    }

    return notFoundResponse();
  }
} satisfies ExportedHandler<Env>;
