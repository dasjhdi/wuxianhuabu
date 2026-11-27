import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { platformPresets, recipes } from "@/utils/ecommerce/recipes";

const router = Router();

export default router.get("/", (req, res) => {
  u.auth.currentUser(req);
  res.set("Cache-Control", "no-store").json(success({ recipes, presets: platformPresets }));
});
