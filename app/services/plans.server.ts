import prisma from "../db.server";
import { getReturnPeriodRange } from "./gstr1-exporter.server";

export const PLAN_LIMITS: Record<string, number | null> = { Free: 25, Growth: 500, Pro: null };

export const planName = (plan?: string | null) => (plan && plan in PLAN_LIMITS ? plan : "Free");

/** Paid features: all templates, logo, signature and GSTR-1 files. */
export const hasPaidFeatures = (plan?: string | null) => planName(plan) !== "Free";

function currentMonthStart(now: Date) {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return getReturnPeriodRange(ist.getUTCMonth() + 1, ist.getUTCFullYear()).start;
}

export async function getPlanUsage(shop: string, now: Date = new Date()) {
  const setting = await prisma.storeSetting.findUnique({ where: { shop }, select: { plan: true } });
  const plan = planName(setting?.plan);
  const used = await prisma.invoice.count({ where: { shop, createdAt: { gte: currentMonthStart(now) } } });
  return { plan, used, limit: PLAN_LIMITS[plan] };
}

/**
 * Invoices are always created, so a merchant's records never have gaps. An invoice
 * beyond the month's limit can't be downloaded until the store upgrades.
 */
export async function isInvoiceOverLimit(
  shop: string,
  invoice: { createdAt: Date },
  plan?: string | null,
  now: Date = new Date()
): Promise<boolean> {
  const limit = PLAN_LIMITS[planName(plan)];
  const start = currentMonthStart(now);
  if (limit === null || invoice.createdAt < start) return false;
  const position = await prisma.invoice.count({
    where: { shop, createdAt: { gte: start, lte: invoice.createdAt } },
  });
  return position > limit;
}

export async function savePlan(shop: string, plan: string) {
  await prisma.storeSetting.upsert({ where: { shop }, update: { plan }, create: { shop, plan } });
}
