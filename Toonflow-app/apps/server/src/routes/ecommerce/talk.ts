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
    script: z.string().trim().min(1).max(2000),
    ratio: z.enum(["9:16", "1:1"]),
    voice: z.object({
      providerId: z.string().max(96),
      modelId: z.string().max(256),
      voice: z.string().max(256).optional(),
    }).optional(),
    subtitles: z.boolean().optional(),
    aiLabel: z.boolean().optional(),
  }),
  (req, res) => {
    const user = u.auth.currentUser(req) ?? { id: 0, username: "device" };
    const body = req.body as Parameters<typeof u.ecommerce.enqueueTalkTask>[0];
    const result = u.ecommerce.enqueueTalkTask(body, user);
    u.auth.recordAudit({
      userId: user.id || undefined,
      username: user.username,
      action: "ecommerce.talk",
      targetType: "ecommerce",
      targetId: result.id,
      detail: `创建口播视频任务（${body.ratio}，${body.script.length} 字）`,
      ip: req.ip,
    });
    res.status(202).json(success(result, "口播任务已创建"));
  },
);
