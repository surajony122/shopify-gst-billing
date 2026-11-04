import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);

  // Invoices stay until Shopify sends shop/redact, 48 hours after uninstall.
  await prisma.session.deleteMany({ where: { shop } });

  return new Response("Sessions removed", { status: 200 });
};
