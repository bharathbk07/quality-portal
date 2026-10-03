import { number } from "../shared/config.mjs";
import { buildIntegration } from "./app.mjs";
import { start } from "../shared/http.mjs";
await start(
  buildIntegration(),
  process.env.PORT || number("services", "integration_port"),
);
