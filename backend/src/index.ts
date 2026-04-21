import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

app.listen(config.port, "0.0.0.0", () => {
  console.log(`FinPulse API listening on 0.0.0.0:${config.port}`);
});
