import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(20, Math.max(5, Number(req.query.pageSize) || 10));
  const user = u.auth.currentUser(req);
  res.set("Cache-Control", "no-store").json(success({
    items: u.ecommerce.listBatchTasks(pageSize, (page - 1) * pageSize, user),
    total: u.ecommerce.countBatchTasks(user),
    page,
    pageSize,
  }));
});
