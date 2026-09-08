import "dotenv/config";
import { env } from "../config/env.js";
import { createRestApiApp } from "./app.js";

const app = createRestApiApp();
const port = env.restApi.port;

app.listen(port, () => {
  console.log(
    JSON.stringify({
      service: "rest-api",
      status: "listening",
      port,
      seed: env.restApi.seedPath,
      endpoints: ["/health", "/products", "/products/:id", "/orders (GET/POST)", "/metrics"]
    })
  );
});
