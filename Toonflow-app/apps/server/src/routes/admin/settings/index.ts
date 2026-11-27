import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", async (req, res) => {
  u.auth.requireAdmin(req);
  const [storage] = await Promise.all([u.admin.dataUsage()]);
  res.set("Cache-Control", "no-store").json(success({
    system: u.auth.getSystemSettings(),
    providers: u.admin.providerSummary(),
    runtime: {
      version: String(req.app.locals.appVersion ?? ""),
      platform: process.platform,
      arch: process.arch,
      bun: process.versions.bun ?? "",
      dataDirectory: u.auth.dataDirectory(),
      storageBytes: storage.size,
      storageFiles: storage.files,
    },
  }));
});
