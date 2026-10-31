import { Router } from "express";
import {
  adminLogin,
  changeAdminCredentials,
  getAdminSettings,
  saveAdminSettings,
} from "../controller/admin.controller.js";
import {
  requireAdmin,
  requireAdminListener,
} from "../middleware/admin-auth.js";

const router: Router = Router();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.use(requireAdminListener);
router.post("/login", adminLogin);
router.get("/settings", requireAdmin, getAdminSettings);
router.put("/settings", requireAdmin, saveAdminSettings);
router.post("/credentials", requireAdmin, changeAdminCredentials);

export default router;
