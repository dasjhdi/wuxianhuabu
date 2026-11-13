// 逻辑联调：用模拟响应验证请求体构造、轮询与失败分支，不消耗平台额度
import provider from "D:/wuxianhuabu/custom-providers/kunrou.ts";

const calls: { url: string; init: any }[] = [];

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const context = (script: readonly unknown[]) => {
  let index = 0;
  return {
    config: { apiKey: "test-key" },
    tool: {
      fetch: async (url: any, init: any) => {
        calls.push({ url: String(url), init });
        const next = script[Math.min(index++, script.length - 1)];
        return typeof next === "function" ? (next as () => Response)() : respond(next);
      },
      errorMessage: (value: unknown) => String(value),
    },
    saveTaskData: async (data: any) => console.log("已保存恢复数据:", JSON.stringify(data)),
  };
};

// 1. 正常流程：提交 → 排队 → 完成
calls.length = 0;
const ok = await (provider as any).generateVideo.call(
  context([
    { id: "task_1", object: "video", status: "queued" },
    { id: "task_1", status: "in_progress", progress: 40 },
    { id: "task_1", status: "completed", progress: 100, url: "https://cdn.example.com/v.mp4", output: [{ url: "https://cdn.example.com/v.mp4" }] },
  ]),
  {
    model: "gemini-omni-1.1-flash", prompt: "  一只纸船在雨后水洼中缓慢漂流  ", duration: 8,
    resolution: "720p", ratio: "16:9",
    firstFrame: { type: "url", url: "https://cdn.example.com/first.png" },
    lastFrame: { type: "base64", data: "TEFTVEJZVEVT", mimeType: "image/png" },
    images: [{ type: "binary", data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" }],
    audios: [{ type: "url", url: "https://cdn.example.com/a.mp3" }],
  },
);
console.log("✅ 返回结果:", JSON.stringify(ok));
console.log("✅ 提交体:", calls[0].init.body);
console.log("✅ 轮询次数:", calls.length - 1, "| 首次查询地址:", calls[1].url);

// 2. 远端失败
try {
  await (provider as any).generateVideo.call(
    context([{ id: "task_2", status: "queued" }, { id: "task_2", status: "failed", error: { message: "内容审核未通过" } }]),
    { model: "gemini-omni-1.1-flash", prompt: "测试失败分支" },
  );
  console.log("❌ 失败分支未抛出");
} catch (error: any) {
  console.log("✅ 失败分支:", error.code, error.message);
}

// 3. 鉴权失败
try {
  await (provider as any).generateVideo.call(
    context([() => respond({ error: { message: "invalid api key" } }, 401)]),
    { model: "gemini-omni-1.1-flash", prompt: "测试鉴权" },
  );
  console.log("❌ 鉴权分支未抛出");
} catch (error: any) {
  console.log("✅ 鉴权分支:", error.message);
}

// 4. 恢复任务
calls.length = 0;
const resumed = await (provider as any).resumeTask.call(
  context([{ id: "task_1", status: "completed", url: "https://cdn.example.com/resume.mp4" }]),
  { kind: "video", taskId: "task_1", model: "gemini-omni-1.1-flash" },
);
console.log("✅ 恢复任务:", JSON.stringify(resumed), "| 请求:", calls[0].url);

// 5. 非法输入
try {
  await (provider as any).generateVideo.call(context([{}]), { model: "gemini-omni-1.1-flash", prompt: "  " });
  console.log("❌ 空提示词未拦截");
} catch (error: any) {
  console.log("✅ 空提示词拦截:", error.message);
}
