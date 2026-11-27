import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.put(
  "/",
  validateFields({
    siteName: z.string().trim().min(1).max(40).optional(),
    allowRegister: z.boolean().optional(),
    sessionDays: z.number().int().min(1).max(30).optional(),
    defaultRole: z.enum(["admin", "member", "viewer"]).optional(),
    registrationNotice: z.string().max(200).optional(),
  }),
  (req, res) => {
    const admin = u.auth.requireAdmin(req);
    const next = u.auth.saveSystemSettings(req.body as Record<string, unknown>);
    u.auth.recordAudit({
      userId: admin.id,
      username: admin.username,
      action: "settings.save",
      targetType: "system",
      detail: `更新系统设置：${Object.keys(req.body as Record<string, unknown>).join("、")}`,
      ip: req.ip,
    });
    res.json(success(next, "系统设置已保存"));
  },
);
