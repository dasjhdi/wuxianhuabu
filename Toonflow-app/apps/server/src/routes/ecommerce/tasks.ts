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
    recipeId: z.string().min(1).max(40),
    outputs: z.array(z.object({
      ratio: z.string().regex(/^[1-9]\d{0,3}:[1-9]\d{0,3}$/),
      width: z.number().int().min(256).max(4096),
      height: z.number().int().min(256).max(4096),
      label: z.string().max(80).optional(),
    })).min(1).max(4),
    scenePrompt: z.string().max(2000).optional(),
    providerId: z.string().max(96).optional(),
    modelId: z.string().max(256).optional(),
    aiLabel: z.boolean().optional(),
  }),
  (req, res) => {
    const user = u.auth.currentUser(req) ?? { id: 0, username: "device" };
    const body = req.body as Parameters<typeof u.ecommerce.enqueueTask>[0];
    const result = u.ecommerce.enqueueTask({
      ...body,
      brief: body.brief ?? {},
    }, user);
    u.auth.recordAudit({
      userId: user.id || undefined,
      username: user.username,
      action: "ecommerce.task",
      targetType: "ecommerce",
      targetId: result.id,
      detail: `创建电商套图任务（${body.recipeId}，${body.outputs.length} 个尺寸）`,
      ip: req.ip,
    });
    res.status(202).json(success(result, "任务已创建"));
  },
);
