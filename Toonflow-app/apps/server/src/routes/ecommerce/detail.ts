import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.post(
  "/",
  validateFields({
    images: z.array(z.object({
      data: z.string().min(100).max(30_000_000),
      mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
      name: z.string().max(200).optional(),
    })).min(1).max(1),
    brief: z.object({
      title: z.string().max(200).optional(),
      category: z.string().max(80).optional(),
      sellingPoints: z.array(z.string().max(120)).max(8).optional(),
    }).optional(),
    width: z.union([z.literal(750), z.literal(800)]).optional(),
    style: z.enum(["scene", "white"]).optional(),
    providerId: z.string().max(96).optional(),
    modelId: z.string().max(256).optional(),
    aiLabel: z.boolean().optional(),
  }),
  (req, res) => {
    const user = u.auth.currentUser(req) ?? { id: 0, username: "device" };
    const body = req.body as Parameters<typeof u.ecommerce.enqueueDetailTask>[0];
    const result = u.ecommerce.enqueueDetailTask({ ...body, brief: body.brief ?? {} }, user);
    u.auth.recordAudit({
      userId: user.id || undefined,
      username: user.username,
      action: "ecommerce.detail",
      targetType: "ecommerce",
      targetId: result.id,
      detail: `创建详情页长图任务（${body.width ?? 750}px）`,
      ip: req.ip,
    });
    res.status(202).json(success(result, "详情页任务已创建"));
  },
);
