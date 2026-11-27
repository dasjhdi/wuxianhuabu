import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.get(
  "/",
  validateFields({ id: z.string().regex(/^[a-f0-9]{16}$/) }, "query"),
  (req, res) => {
    u.auth.currentUser(req);
    const task = u.ecommerce.getTask(String(req.query.id), u.auth.currentUser(req));
    if (!task) return res.status(404).json(error("任务不存在", null, 404));
    res.set("Cache-Control", "no-store").json(success(task));
  },
);
