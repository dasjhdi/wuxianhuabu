import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.post(
  "/",
  validateFields({
    csv: z.string().min(3).max(20000),
    style: z.enum(["white", "scene"]).optional(),
    sharedImage: z.object({
      data: z.string().min(100).max(30_000_000),
      mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
      name: z.string().max(200).optional(),
    }).optional(),
    scenePrompt: z.string().max(2000).optional(),
    providerId: z.string().max(96).optional(),
    modelId: z.string().max(256).optional(),
    aiLabel: z.boolean().optional(),
    video: z.object({
      ratio: z.enum(["9:16", "1:1", "16:9"]).optional(),
      duration: z.union([z.literal(5), z.literal(10), z.literal(15)]).optional(),
      transition: z.enum(["none", "fade", "slide"]).optional(),
      subtitles: z.boolean().optional(),
      bgm: z.object({
        data: z.string().min(100).max(30_000_000),
        mimeType: z.string().regex(/^audio\/[a-z0-9.+-]+$/i),
      }).optional(),
    }).optional(),
    targets: z.array(z.object({
      ratio: z.string().max(16).optional(),
      width: z.number().int(),
      height: z.number().int(),
    })).max(4).optional(),
  }),
  (req, res) => {
    const user = u.auth.currentUser(req) ?? { id: 0, username: "device" };
    const body = req.body as Parameters<typeof u.ecommerce.enqueueBatchTask>[0];
    const result = u.ecommerce.enqueueBatchTask(body, user);
    u.auth.recordAudit({
      userId: user.id || undefined,
      username: user.username,
      action: "ecommerce.batch",
      targetType: "ecommerce",
      targetId: result.id,
      detail: `创建批量 SKU 任务（${body.style ?? "white"}）`,
      ip: req.ip,
    });
    res.status(202).json(success(result, "批量任务已创建"));
  },
);
