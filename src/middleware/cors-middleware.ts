import cors from "cors";
import type { CorsOptions } from "cors";

const Options: CorsOptions = {
  origin: process.env.CLIENT_ORIGIN?.split(","),
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  preflightContinue: false,
  optionsSuccessStatus: 204,
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
};

export { Options, cors };
