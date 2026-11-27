import { Router } from "express";
import u from "@/utils";

const router = Router();

export default router.get("/:id/:file", async (req, res) => {
  const asset = await u.ecommerce.readAsset(req.params.id, req.params.file, u.auth.currentUser(req));
  res.set({
    "Content-Type": asset.path.endsWith(".png") ? "image/png" : asset.path.endsWith(".webp") ? "image/webp" : "image/jpeg",
    "Cache-Control": "private, max-age=3600",
  });
  res.end(Buffer.from(asset.bytes));
});
