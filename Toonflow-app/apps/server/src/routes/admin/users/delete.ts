import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.post(
  "/",
  validateFields({ id: z.number().int().positive() }),
  (req, res) => {
    const admin = u.auth.requireAdmin(req);
    const { id } = req.body as { id: number };
    if (id === admin.id) return res.status(400).json(error("不能删除当前登录的账号", null, 400));
    const target = u.auth.findUserById(id);
    if (!target) return res.status(404).json(error("用户不存在", null, 404));
    u.auth.deleteUser(id);
    u.auth.recordAudit({
      userId: admin.id,
      username: admin.username,
      action: "user.delete",
      targetType: "user",
      targetId: id,
      detail: `删除账号 ${target.username}`,
      ip: req.ip,
    });
    res.json(success(null, "账号已删除"));
  },
);
