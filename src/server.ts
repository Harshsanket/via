import app from "./app.js";
import dotenv from "dotenv";
import { prisma } from "./database/index.js";
import { main } from "./database/script.js";

dotenv.config({ path: "" });

const PORT = process.env.PORT;

app.listen(PORT, () => {
  console.log("port", PORT);
  console.log(`App is live on port :: ${PORT}`);

  main().catch(async (e) => {
    console.error("Error in main() ::", e);
    await prisma.$disconnect();
    process.exit(1);
  });
});

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});
