import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.post(
  "/",
  validateFields({
    id: z.string().regex(/^[a-f0-9]{16}$/),
    rows: z.array(z.number().int().min(0).max(199)).max(20).optional(),
  }),
  async (req, res) => {
    const user = u.auth.currentUser(req) ?? { id: 0, username: "device" };
    const body = req.body as { id: string; rows?: number[] };
    try {
      const result = await u.ecommerce.resumeBatchTask(body.id, body.rows, u.auth.currentUser(req));
      u.auth.recordAudit({
        userId: user.id || undefined,
        username: user.username,
        action: "ecommerce.batch.resume",
        targetType: "ecommerce",
        targetId: body.id,
        detail: `续跑批量任务 ${result.rows} 行`,
        ip: req.ip,
      });
      res.status(202).json(success(result, "已加入队列"));
    } catch (cause) {
      const failure = cause as { status?: number; message?: string } | null;
      res.status(failure?.status ?? 500).json(error(failure?.message || "续跑失败", null, failure?.status ?? 500));
    }
  },
);
