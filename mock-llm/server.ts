// 本地 OpenAI 兼容服务：仅用于验证创梦的模型链路，不属于项目代码
const PORT = 8790;

function completion(content: string) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "mock-chat",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 },
  };
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    console.log(`[mock-llm] ${request.method} ${url.pathname}`);

    if (url.pathname.endsWith("/models")) {
      return Response.json({ object: "list", data: [{ id: "mock-chat", object: "model", owned_by: "local" }] });
    }

    if (url.pathname.endsWith("/chat/completions")) {
      const body = await request.json().catch(() => ({}));
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const last = messages.at(-1);
      const prompt = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
      const answer = `本地模拟模型已收到请求。对话消息 ${messages.length} 条，最后一条内容：${prompt.slice(0, 40)}`;

      if (body.stream) {
        const encoder = new TextEncoder();
        const chunks = [...answer].reduce<string[]>((acc, char, index) => {
          if (index % 8 === 0) acc.push("");
          acc[acc.length - 1] += char;
          return acc;
        }, []);
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "chatcmpl-stream", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "mock-chat", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`));
            for (const chunk of chunks) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "chatcmpl-stream", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "mock-chat", choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })}\n\n`));
              await Bun.sleep(8);
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "chatcmpl-stream", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "mock-chat", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 } })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
      }

      return Response.json(completion(answer));
    }

    return Response.json({ error: { message: "not found" } }, { status: 404 });
  },
});

console.log(`[mock-llm] 已启动 http://127.0.0.1:${PORT}/v1`);
