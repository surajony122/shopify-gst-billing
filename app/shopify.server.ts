import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const GROWTH_PLAN = "Growth";
export const PRO_PLAN = "Pro";

const shopify = shopifyApp({
  apiKey: requireEnv("SHOPIFY_API_KEY"),
  apiSecretKey: requireEnv("SHOPIFY_API_SECRET"),
  apiVersion: ApiVersion.October26,
  scopes: process.env.SCOPES?.split(",") || ["read_products", "read_orders"],
  appUrl: process.env.APP_URL || process.env.SHOPIFY_APP_URL || "https://gst.thewommedia.com",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  isEmbeddedApp: true,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  billing: {
    [GROWTH_PLAN]: {
      trialDays: 7,
      lineItems: [{ amount: 6, currencyCode: "USD", interval: BillingInterval.Every30Days }],
    },
    [PRO_PLAN]: {
      trialDays: 7,
      lineItems: [{ amount: 15, currencyCode: "USD", interval: BillingInterval.Every30Days }],
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
