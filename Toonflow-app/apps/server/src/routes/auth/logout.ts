import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.post("/", (req, res) => {
  const user = u.auth.currentUser(req) ?? u.auth.resolveSession(req);
  u.auth.destroySession(req, res);
  if (user) u.auth.recordAudit({ userId: user.id, username: user.username, action: "logout", ip: req.ip });
  res.json(success(null, "已退出登录"));
});
