import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", (req, res) => {
  res.set("Cache-Control", "no-store").json(success({ items: u.ecommerce.listTasks(20, u.auth.currentUser(req)) }));
});
