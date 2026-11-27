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
    ratio: z.enum(["9:16", "1:1", "16:9"]),
    duration: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    prompt: z.string().max(2000).optional(),
    transition: z.enum(["none", "fade", "slide"]).optional(),
    bgm: z.object({
      data: z.string().min(100).max(30_000_000),
      mimeType: z.string().regex(/^audio\/[a-z0-9.+-]+$/i),
    }).optional(),
    subtitles: z.array(z.string().max(60)).max(3).optional(),
    providerId: z.string().max(96).optional(),
    modelId: z.string().max(256).optional(),
    aiLabel: z.boolean().optional(),
  }),
  (req, res) => {
    const user = u.auth.currentUser(req) ?? { id: 0, username: "device" };
    const body = req.body as Parameters<typeof u.ecommerce.enqueueVideoTask>[0];
    const result = u.ecommerce.enqueueVideoTask({ ...body, brief: body.brief ?? {} }, user);
    u.auth.recordAudit({
      userId: user.id || undefined,
      username: user.username,
      action: "ecommerce.video",
      targetType: "ecommerce",
      targetId: result.id,
      detail: `创建主图视频任务（${body.ratio}，${body.duration} 秒）`,
      ip: req.ip,
    });
    res.status(202).json(success(result, "视频任务已创建"));
  },
);
