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
    const system = u.auth.getSystemSettings();
    if (!system.allowRegister) return res.status(403).json(error(system.registrationNotice || "管理员未开放自助注册", null, 403));
    const body = req.body as { username: string; password: string; displayName?: string };
    const role = system.defaultRole === "admin" ? "member" : system.defaultRole;
    const user = await u.auth.createUser({ ...body, role });
    u.auth.createSession(user.id, req, res);
    u.auth.recordAudit({
      userId: user.id,
      username: user.username,
      action: "user.register",
      targetType: "user",
      targetId: user.id,
      detail: `自助注册（${role}）`,
      ip: req.ip,
    });
    res.status(201).json(success(u.auth.publicUser(user), "注册成功"));
  },
);
