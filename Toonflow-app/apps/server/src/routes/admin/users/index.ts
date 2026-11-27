import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get(
  "/",
  validateFields({ q: z.string().max(64).optional(), role: z.enum(["admin", "member", "viewer"]).optional() }, "query"),
  (req, res) => {
    u.auth.requireAdmin(req);
    const query = String(req.query.q ?? "").trim().toLowerCase();
    const role = req.query.role as string | undefined;
    const items = u.auth.listUsers()
      .map(u.auth.publicUser)
      .filter(user => !role || user.role === role)
      .filter(user => !query || user.username.toLowerCase().includes(query) || user.displayName.toLowerCase().includes(query));
    res.set("Cache-Control", "no-store").json(success({ total: items.length, items }));
  },
);
