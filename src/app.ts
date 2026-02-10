import express from "express";
import cors from "cors";

var corsOptions = {
  origin: process.env.CLIENT_ORIGIN,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  preflightContinue: false,
  optionsSuccessStatus: 204,
  credentials: true,
};

const app = express();
app.use(cors(corsOptions));

app.get("/", (req, res) => {
  res.send("Hello World! Inital test for via app :)");
});

export default app;
