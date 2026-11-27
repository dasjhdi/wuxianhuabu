import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.post(
  "/",
  validateFields({ id: z.number().int().positive(), password: z.string().min(8).max(128) }),
  async (req, res) => {
    const admin = u.auth.requireAdmin(req);
    const { id, password } = req.body as { id: number; password: string };
    const target = u.auth.findUserById(id);
    if (!target) return res.status(404).json(error("用户不存在", null, 404));
    await u.auth.updateUserPassword(id, password);
    u.auth.recordAudit({
      userId: admin.id,
      username: admin.username,
      action: "user.resetPassword",
      targetType: "user",
      targetId: id,
      detail: `重置账号 ${target.username} 的密码`,
      ip: req.ip,
    });
    res.json(success(null, "密码已重置，该用户需要重新登录"));
  },
);
