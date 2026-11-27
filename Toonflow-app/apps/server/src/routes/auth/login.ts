import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

const router = Router();

export default router.post(
  "/",
  validateFields({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(128),
    remember: z.boolean().optional(),
  }),
  async (req, res) => {
    const { username, password, remember } = req.body as { username: string; password: string; remember?: boolean };
    const key = req.ip ?? "unknown";
    if (!u.auth.loginAllowed(key)) return res.status(429).json(error("尝试次数过多，请 10 分钟后再试", null, 429));
    const row = u.auth.findUserByUsername(username);
    const valid = row ? await u.auth.verifyPassword(password, row.password_hash) : false;
    if (!row || !valid) {
      u.auth.recordLoginFailure(key);
      u.auth.recordAudit({ username, action: "login.failed", detail: "用户名或密码错误", ip: key });
      return res.status(401).json(error("用户名或密码不正确", null, 401));
    }
    if (row.status !== "active") {
      u.auth.recordAudit({ userId: row.id, username: row.username, action: "login.disabled", detail: "账号已被禁用", ip: key });
      return res.status(403).json(error("该账号已被禁用，请联系管理员", null, 403));
    }
    u.auth.clearLoginFailures(key);
    u.auth.createSession(row.id, req, res, remember === true);
    u.auth.recordAudit({ userId: row.id, username: row.username, action: "login.success", detail: remember ? "记住登录状态" : "", ip: key });
    res.json(success(u.auth.publicUser(u.auth.findUserById(row.id)!), "登录成功"));
  },
);
