import app from "./app.js";
import dotenv from "dotenv";
import { prisma } from "./database/index.js";
import { main } from "./database/script.js";
import { createServer } from "http";
import { Server } from "socket.io";
import { initSocket } from "./config/socket/index.js";
import { logger } from "./utils/logger.js";

dotenv.config({ path: "" });

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN?.split(","),
    credentials: true,
  },
});

initSocket(io);

httpServer.listen(process.env.PORT || 3000, () => {
  console.log(`Server is online at port :: ${process.env.PORT}`)
  logger.info("Server is online");
  main().catch(async (e) => {
    logger.warn("Error in main() ::", e);
    await prisma.$disconnect();
    process.exit(1);
  });
});

// Handle graceful shutdown
process.on("SIGINT", async () => {
  logger.info("\nShutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("\nShutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});
