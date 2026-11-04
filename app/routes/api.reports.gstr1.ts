import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { hasPaidFeatures } from "../services/plans.server";
import {
  buildGSTR1Json,
  generateGSTR1Workbook,
  getReturnPeriodRange,
} from "../services/gstr1-exporter.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "xlsx";
  const month = parseInt(url.searchParams.get("month") || "", 10);
  const year = parseInt(url.searchParams.get("year") || "", 10);

  if (!["xlsx", "json"].includes(format)) {
    return new Response("Unsupported export format", { status: 400 });
  }
  if (!(month >= 1 && month <= 12) || !(year >= 2017 && year <= 2100)) {
    return new Response("Choose a valid return period", { status: 400 });
  }

  const { start, end } = getReturnPeriodRange(month, year);

  const [invoices, cancelledInvoices, creditNotes, setting] = await Promise.all([
    prisma.invoice.findMany({
      where: { shop, status: "ACTIVE", invoiceDate: { gte: start, lt: end } },
      include: { lineItems: true },
    }),
    prisma.invoice.findMany({
      where: { shop, status: "CANCELLED", invoiceDate: { gte: start, lt: end } },
      select: { invoiceNumber: true },
    }),
    prisma.creditNote.findMany({
      where: { shop, date: { gte: start, lt: end } },
      include: { invoice: { include: { lineItems: true } } },
    }),
    prisma.storeSetting.findUnique({ where: { shop } }),
  ]);

  if (!hasPaidFeatures(setting?.plan)) {
    return new Response("GSTR-1 files are included in the Growth and Pro plans. Start a free trial in Plan & Billing.", { status: 402 });
  }

  if (setting?.taxScheme === "composition") {
    return new Response("Composition dealers file CMP-08 and GSTR-4, not GSTR-1", { status: 400 });
  }

  const cancelledNumbers = cancelledInvoices.map((inv) => inv.invoiceNumber);

  if (format === "json") {
    if (!setting?.gstin) {
      return new Response("Add your GSTIN in GST Settings before exporting the JSON file", { status: 400 });
    }

    return new Response(JSON.stringify(buildGSTR1Json(invoices, creditNotes, setting.gstin, month, year, cancelledNumbers), null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="GSTR1_${month}_${year}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return new Response(new Uint8Array(generateGSTR1Workbook(invoices, creditNotes, cancelledNumbers)), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="GSTR1_${month}_${year}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
};
