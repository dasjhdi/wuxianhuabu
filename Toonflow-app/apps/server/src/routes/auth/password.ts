import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.put(
  "/",
  validateFields({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8).max(128),
  }),
  async (req, res) => {
    const user = u.auth.currentUser(req);
    if (!user) return res.status(401).json(error("请先登录后再操作", null, 401));
    const row = u.auth.findUserById(user.id);
    if (!row || !(await u.auth.verifyPassword((req.body as { currentPassword: string }).currentPassword, row.password_hash))) {
      return res.status(400).json(error("当前密码不正确", null, 400));
    }
    await u.auth.updateUserPassword(user.id, (req.body as { newPassword: string }).newPassword);
    u.auth.recordAudit({ userId: user.id, username: user.username, action: "password.change", detail: "修改自己的登录密码", ip: req.ip });
    res.json(success(null, "密码已更新，请使用新密码登录"));
  },
);
