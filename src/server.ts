import app from "./app.js";
import dotenv from "dotenv";
import { prisma } from "./database/index.js";
import { main } from "./database/script.js";

dotenv.config({ path: "../.env" });

const PORT = process.env.PORT;

app.listen(PORT, async () => {
  try {
    main()
      .then(async () => {
        await prisma.$disconnect();
      })
      .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
      });
    console.log(`App is live on port :: ${PORT}`);
  } catch (error) {
    console.log("Error while starting the server :: ", error);
  }
});
