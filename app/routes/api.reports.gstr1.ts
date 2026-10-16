import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import { generateGSTR1Workbook, GSTR1InvoiceRecord } from "../../services/gstr1-exporter.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "xlsx";
  const month = parseInt(url.searchParams.get("month") || "10", 10);
  const year = parseInt(url.searchParams.get("year") || "2026", 10);

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  const invoices = await prisma.invoice.findMany({
    where: {
      invoiceDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: { lineItems: true },
  });

  const records: GSTR1InvoiceRecord[] = [];
  invoices.forEach((inv) => {
    inv.lineItems.forEach((item) => {
      records.push({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: new Date(inv.invoiceDate).toLocaleDateString("en-IN"),
        orderNumber: inv.shopifyOrderNumber,
        isB2B: inv.isB2B,
        buyerGstin: inv.buyerGstin || undefined,
        buyerTradeName: inv.buyerTradeName || undefined,
        placeOfSupplyCode: inv.placeOfSupplyCode,
        placeOfSupplyState: inv.placeOfSupplyState,
        isInterState: inv.isInterState,
        taxableValue: item.taxableValue,
        gstRate: item.gstRate,
        cgstAmount: item.cgstAmount,
        sgstAmount: item.sgstAmount,
        igstAmount: item.igstAmount,
        cessAmount: 0,
        totalInvoiceValue: inv.grandTotal,
        hsnCode: item.hsnCode,
        quantity: item.quantity,
      });
    });
  });

  if (format === "json") {
    // Official GST Offline Portal Schema
    const gstr1Json = {
      gstin: "27AABCU9603R1ZM",
      fp: `${String(month).padStart(2, "0")}${year}`,
      gt: records.reduce((s, r) => s + r.totalInvoiceValue, 0),
      cur_gt: records.reduce((s, r) => s + r.totalInvoiceValue, 0),
      b2b: records.filter((r) => r.isB2B).map((r) => ({
        ctin: r.buyerGstin,
        inv: [{
          inum: r.invoiceNumber,
          idt: r.invoiceDate,
          val: r.totalInvoiceValue,
          pos: r.placeOfSupplyCode,
          rchrg: "N",
          inv_typ: "R",
          itms: [{
            num: 1,
            itm_det: {
              rt: r.gstRate,
              txval: r.taxableValue,
              iamt: r.igstAmount,
              camt: r.cgstAmount,
              samt: r.sgstAmount,
              csamt: 0,
            },
          }],
        }],
      })),
      b2cs: records.filter((r) => !r.isB2B).map((r) => ({
        sply_ty: r.isInterState ? "INTER" : "INTRA",
        rt: r.gstRate,
        typ: "OE",
        pos: r.placeOfSupplyCode,
        txval: r.taxableValue,
        iamt: r.igstAmount,
        camt: r.cgstAmount,
        samt: r.sgstAmount,
        csamt: 0,
      })),
    };

    return new Response(JSON.stringify(gstr1Json, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="GSTR1_${month}_${year}.json"`,
      },
    });
  }

  const xlsxBuffer = generateGSTR1Workbook(records);
  return new Response(xlsxBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="GSTR1_${month}_${year}.xlsx"`,
    },
  });
};
