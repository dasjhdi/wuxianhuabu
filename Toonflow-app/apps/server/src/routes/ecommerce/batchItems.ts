import { Router } from "express";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", (req, res) => {
  u.auth.currentUser(req);
  const id = typeof req.query.id === "string" ? req.query.id : "";
  if (!id) return res.status(400).json(error("缺少任务编号"));
  const task = u.ecommerce.getBatchTask(id, u.auth.currentUser(req));
  if (!task) return res.status(404).json(error("批量任务不存在", null, 404));
  res.set("Cache-Control", "no-store").json(success({ task, items: u.ecommerce.listBatchItems(id) }));
});
