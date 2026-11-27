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
    role: z.enum(["admin", "member", "viewer"]).optional(),
  }),
  async (req, res) => {
    const admin = u.auth.requireAdmin(req);
    const body = req.body as { username: string; password: string; displayName?: string; role?: "admin" | "member" | "viewer" };
    const user = await u.auth.createUser(body);
    u.auth.recordAudit({
      userId: admin.id,
      username: admin.username,
      action: "user.create",
      targetType: "user",
      targetId: user.id,
      detail: `创建账号 ${user.username}（${user.role}）`,
      ip: req.ip,
    });
    res.status(201).json(success(u.auth.publicUser(user), "账号已创建"));
  },
);
