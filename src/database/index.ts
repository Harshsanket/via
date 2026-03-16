import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import dotenv from "dotenv";
import { logger } from "../utils/logger.js";

//idk why it was not working without this
dotenv.config({ path: "" });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined in environment variables");
}

const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });

export const connectPrisma = async () => {
  try {
    logger.info(`[PRISMA] :: Connecting to database...`);
    await prisma.$connect();

    const result = await prisma.$queryRaw`SELECT 1`;
    if (!result)
      logger.warn(`[PRISMA] :: Something went wrong while fetching query`);

    logger.info(
      `[PRISMA] :: Database connection successful :: ${process.env.DATABASE_URL}`,
    );
  } catch (err) {
    logger.error(`[PRISMA] :: Database connection error :: ${err}`);
    throw err;
  }
};
