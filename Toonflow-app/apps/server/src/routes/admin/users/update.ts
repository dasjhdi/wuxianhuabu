import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.post(
  "/",
  validateFields({
    id: z.number().int().positive(),
    displayName: z.string().trim().max(40).optional(),
    role: z.enum(["admin", "member", "viewer"]).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  }),
  (req, res) => {
    const admin = u.auth.requireAdmin(req);
    const body = req.body as { id: number; displayName?: string; role?: "admin" | "member" | "viewer"; status?: "active" | "disabled" };
    if (body.id === admin.id && (body.status === "disabled" || (body.role && body.role !== "admin"))) {
      return res.status(400).json(error("不能禁用或降级当前登录的管理员账号", null, 400));
    }
    const user = u.auth.updateUser(body.id, { displayName: body.displayName, role: body.role, status: body.status });
    u.auth.recordAudit({
      userId: admin.id,
      username: admin.username,
      action: "user.update",
      targetType: "user",
      targetId: user.id,
      detail: `更新账号 ${user.username}：角色 ${user.role}，状态 ${user.status}`,
      ip: req.ip,
    });
    res.json(success(u.auth.publicUser(user), "账号已更新"));
  },
);
