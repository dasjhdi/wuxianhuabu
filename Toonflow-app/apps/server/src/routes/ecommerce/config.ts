import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", (req, res) => {
  const user = u.auth.currentUser(req);
  res.set("Cache-Control", "no-store").json(success({
    ...u.ecommerce.publicConfig(),
    canEdit: user?.role === "admin",
  }));
});
