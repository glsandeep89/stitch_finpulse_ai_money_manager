import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { config, requireEnv } from "../../config.js";

const envKey = (config.plaidEnv || "sandbox").toLowerCase();
const basePath =
  envKey === "production"
    ? PlaidEnvironments.production
    : envKey === "development"
      ? PlaidEnvironments.development
      : PlaidEnvironments.sandbox;

const configuration = new Configuration({
  basePath,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": config.plaidClientId ?? requireEnv("PLAID_CLIENT_ID"),
      "PLAID-SECRET": config.plaidSecret ?? requireEnv("PLAID_SECRET"),
    },
  },
});

export const plaidClient = new PlaidApi(configuration);
