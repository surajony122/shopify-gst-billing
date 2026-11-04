import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { planName, savePlan } from "../services/plans.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const subscription = (payload as any)?.app_subscription;
  await savePlan(shop, subscription?.status === "ACTIVE" ? planName(subscription.name) : "Free");
  return new Response("OK", { status: 200 });
};
