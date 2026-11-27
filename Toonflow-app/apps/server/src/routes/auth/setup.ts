import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.post(
  "/",
  validateFields({
    username: z.string().trim().min(3).max(32),
    password: z.string().min(8).max(128),
    displayName: z.string().trim().max(40).optional(),
  }),
  async (req, res) => {
    if (u.auth.countUsers() > 0) return res.status(409).json(error("系统已完成初始化，请直接登录", null, 409));
    const { username, password, displayName } = req.body as { username: string; password: string; displayName?: string };
    const user = await u.auth.createUser({ username, password, displayName, role: "admin" });
    u.auth.createSession(user.id, req, res);
    u.auth.recordAudit({
      userId: user.id,
      username: user.username,
      action: "system.setup",
      targetType: "user",
      targetId: user.id,
      detail: "创建初始管理员账号",
      ip: req.ip,
    });
    res.status(201).json(success(u.auth.publicUser(user), "初始化完成"));
  },
);
