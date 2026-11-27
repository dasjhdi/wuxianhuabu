import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.post(
  "/",
  validateFields({ id: z.string().regex(/^[a-f0-9]{16}$/) }),
  (req, res) => {
    const user = u.auth.currentUser(req) ?? { id: 0, username: "device" };
    const id = (req.body as { id: string }).id;
    try {
      const result = u.ecommerce.cancelTask(id, u.auth.currentUser(req));
      u.auth.recordAudit({
        userId: user.id || undefined,
        username: user.username,
        action: "ecommerce.cancel",
        targetType: "ecommerce",
        targetId: id,
        detail: "取消电商任务",
        ip: req.ip,
      });
      res.json(success(result, "任务已取消"));
    } catch (cause) {
      const failure = cause as { status?: number; message?: string } | null;
      res.status(failure?.status ?? 500).json(error(failure?.message || "取消失败", null, failure?.status ?? 500));
    }
  },
);
