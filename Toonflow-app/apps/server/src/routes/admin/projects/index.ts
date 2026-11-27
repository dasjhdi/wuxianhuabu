import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", async (req, res) => {
  u.auth.requireAdmin(req);
  const projects = await u.admin.listProjects();
  res.set("Cache-Control", "no-store").json(success({
    total: projects.length,
    totalSize: projects.reduce((sum, project) => sum + project.size, 0),
    items: projects,
  }));
});
