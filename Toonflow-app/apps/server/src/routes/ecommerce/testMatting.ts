import { Router } from "express";
import u from "@/utils";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.post("/", async (req, res) => {
  const admin = u.auth.requireAdmin(req);
  try {
    const result = await u.ecommerce.testMatting();
    u.auth.recordAudit({
      userId: admin.id,
      username: admin.username,
      action: "ecommerce.matting.test",
      targetType: "system",
      detail: `测试抠图服务（${result.provider}，${result.latencyMs}ms）`,
      ip: req.ip,
    });
    res.json(success(result, `连接正常，耗时 ${result.latencyMs} ms`));
  } catch (cause) {
    const failure = cause as { status?: number; message?: string } | null;
    res.status(failure?.status ?? 500).json(error(failure?.message || "连接失败", null, failure?.status ?? 500));
  }
});
