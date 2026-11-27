import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get(
  "/",
  validateFields({ days: z.coerce.number().int().min(1).max(90).optional() }, "query"),
  (req, res) => {
    u.auth.requireAdmin(req);
    const days = Number(req.query.days ?? 7);
    res.set("Cache-Control", "no-store").json(success(u.admin.usageTrend(days)));
  },
);
