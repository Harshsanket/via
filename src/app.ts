import express from "express";
import { Options, cors } from "./middleware/cors-middleware.js";
import pinoHttp from "pino-http";
import { logger } from "./utils/logger.js";

const app = express();
const corsOptions = Options;

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(pinoHttp.default({ logger }));

app.get("/", (req, res) => {
  res.send("Hello World! Inital test for via app :)");
});

import healthRouter from "./routes/health.route.js";
app.use("/api/v1", healthRouter);

export default app;
