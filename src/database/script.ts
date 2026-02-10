import { prisma } from "./index.js";

export async function main() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("Prisma DB connected");
  } catch (err) {
    console.error("Prisma DB connection failed :: err");
  }
}
