import u from "@/utils";
import { Router } from "express";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", (req, res) => {
  res.set("Cache-Control", "no-store");
  // ACT: 远程/隧道访客只返回“未启用”状态：不暴露设备与目录信息，也不阻断应用启动。
  if (!u.workspace.isLocalWorkspaceRequest(req)) {
    res.json(success({
      initialized: false, enabled: false, hubEnabled: false, pairingAvailable: false,
      port: 0, addresses: [], publicUrl: "", directories: [], appVersion: req.app.locals.appVersion, devices: [],
    }));
    return;
  }
  u.mobileLink.assertMobileLinkControl(req);
  res.json(success(u.mobileLink.getMobileLinkStatus(req.app)));
});
