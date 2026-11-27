import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get(
  "/",
  validateFields({
    page: z.coerce.number().int().min(1).max(100000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    q: z.string().max(64).optional(),
    action: z.string().max(40).optional(),
  }, "query"),
  (req, res) => {
    u.auth.requireAdmin(req);
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 20);
    res.set("Cache-Control", "no-store").json(success(u.admin.auditList({
      page,
      pageSize,
      query: req.query.q ? String(req.query.q) : undefined,
      action: req.query.action ? String(req.query.action) : undefined,
    })));
  },
);
