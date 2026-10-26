import { getIceServers } from "../controller/ice.controller.js";
import { Router } from "express";

const router: Router = Router();
router.get("/ice-servers", getIceServers);

export default router;
