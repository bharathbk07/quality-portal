import { number } from "../../backend/shared/config.mjs";
import { buildBff } from "./app.mjs";
import { start } from "../../backend/shared/http.mjs";
await start(
  await buildBff(),
  process.env.PORT || number("services", "bff_port"),
);
