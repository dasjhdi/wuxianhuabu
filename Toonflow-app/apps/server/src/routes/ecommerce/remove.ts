import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.post(
  "/",
  validateFields({ id: z.string().regex(/^[a-f0-9]{16}$/) }),
  async (req, res) => {
    const user = u.auth.currentUser(req) ?? { id: 0, username: "device" };
    const id = (req.body as { id: string }).id;
    try {
      const result = await u.ecommerce.deleteTask(id, u.auth.currentUser(req));
      u.auth.recordAudit({
        userId: user.id || undefined,
        username: user.username,
        action: "ecommerce.delete",
        targetType: "ecommerce",
        targetId: id,
        detail: "删除电商任务及产物",
        ip: req.ip,
      });
      res.json(success(result, "任务已删除"));
    } catch (cause) {
      const failure = cause as { status?: number; message?: string } | null;
      res.status(failure?.status ?? 500).json(error(failure?.message || "删除失败", null, failure?.status ?? 500));
    }
  },
);
