import { handleAgentRunRequest } from "../modules/agent/agent.handler";
export { SlackConversationAgent } from "../modules/agent/slack-conversation.agent";
import { jsonResponse, notFoundResponse } from "../tools/http-response.tool";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "slack-ai-agent-v2" });
    }

    if (url.pathname === "/agent/run") {
      return handleAgentRunRequest(request, env);
    }

    return notFoundResponse();
  }
} satisfies ExportedHandler<Env>;
