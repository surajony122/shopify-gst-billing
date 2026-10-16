import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "mock_key",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "mock_secret",
  apiVersion: ApiVersion.October24,
  scopes: process.env.SCOPES?.split(",") || [
    "read_products",
    "write_products",
    "read_orders",
    "write_orders",
    "read_fulfillments",
    "read_locations",
    "read_customer_events",
  ],
  appUrl: process.env.APP_URL || "https://shopify-gst-billing.onrender.com",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  isEmbeddedApp: true,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
});

export default shopify;
export const apiVersion = ApiVersion.October24;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
