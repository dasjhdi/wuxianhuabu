import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.post(
  "/",
  validateFields({ name: z.string().min(1).max(120) }),
  async (req, res) => {
    const admin = u.auth.requireAdmin(req);
    const { name } = req.body as { name: string };
    const target = await u.admin.moveProjectToTrash(name);
    u.auth.recordAudit({
      userId: admin.id,
      username: admin.username,
      action: "project.delete",
      targetType: "project",
      targetId: name,
      detail: `移入回收站：${target}`,
      ip: req.ip,
    });
    res.json(success({ movedTo: target }, "项目已移入回收站"));
  },
);
