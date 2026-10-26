import { healthCheck } from "../controller/health.controller.js";
import { Router } from "express";

const router: Router = Router();
router.get("/health", healthCheck);

export default router;
