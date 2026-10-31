import express from "express";
import pinoHttp from "pino-http";
import { cors, corsOptions } from "./middleware/cors-middleware.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/error-middleware.js";
import adminRouter from "./routes/admin.route.js";
import healthRouter from "./routes/health.route.js";
import iceRouter from "./routes/ice.route.js";
import { logger } from "./utils/logger.js";

const app = express();

app.use(cors(corsOptions()));
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(pinoHttp.default({ logger }));

app.use("/api/v1/admin", adminRouter);
app.use("/api/v1", healthRouter);
app.use("/api/v1", iceRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
