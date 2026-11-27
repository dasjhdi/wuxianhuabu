import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", async (req, res) => {
  u.auth.requireAdmin(req);
  const [projects, storage] = await Promise.all([u.admin.listProjects(), u.admin.dataUsage()]);
  const stats = u.admin.overviewStats();
  const trend = u.admin.usageTrend(7);
  const recent = u.admin.auditList({ page: 1, pageSize: 6 });
  res.set("Cache-Control", "no-store").json(success({
    users: {
      total: stats.userStats.total,
      active: stats.userStats.active ?? 0,
      admins: stats.userStats.admins ?? 0,
    },
    projects: {
      total: projects.length,
      canvases: projects.reduce((sum, project) => sum + project.canvasCount, 0),
      assets: projects.reduce((sum, project) => sum + project.assetCount, 0),
    },
    storage: { bytes: storage.size, files: storage.files },
    usage: {
      today: stats.usage.total,
      todaySuccess: stats.usage.success ?? 0,
      auditToday: stats.audit.total,
      trend: trend.days,
    },
    recent: recent.items,
    topProjects: projects.slice(0, 5),
  }));
});
