import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.put(
  "/",
  validateFields({
    matting: z.object({
      provider: z.enum(["photoroom", "removebg", "custom"]).optional(),
      apiKey: z.string().max(512).optional(),
      endpoint: z.string().max(2048).optional(),
    }).optional(),
    scene: z.object({
      providerId: z.string().max(96).optional(),
      modelId: z.string().max(256).optional(),
    }).optional(),
    avatar: z.object({
      provider: z.enum(["none", "did", "custom"]).optional(),
      apiKey: z.string().max(512).optional(),
      endpoint: z.string().max(2048).optional(),
    }).optional(),
  }),
  (req, res) => {
    const admin = u.auth.requireAdmin(req);
    u.ecommerce.saveConfig(req.body as Record<string, unknown>);
    u.auth.recordAudit({
      userId: admin.id,
      username: admin.username,
      action: "ecommerce.config",
      targetType: "system",
      detail: "更新电商与抠图配置",
      ip: req.ip,
    });
    res.json(success(u.ecommerce.publicConfig(), "配置已保存"));
  },
);
