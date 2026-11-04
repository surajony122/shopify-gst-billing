import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { cleanStateName } from "../services/gst-engine";
import { brandingFromSettings, generateGSTInvoicePDF } from "../services/pdf-generator.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const invoiceId = params.id;
  if (!invoiceId) {
    return new Response("Invoice ID required", { status: 400 });
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, shop: session.shop },
    include: { lineItems: true },
  });

  if (!invoice) {
    return new Response("Invoice not found", { status: 404 });
  }

  const setting = await prisma.storeSetting.findUnique({
    where: { shop: invoice.shop },
  });

  const shipTo = invoice.shippingAddress as any;
  // A saved "TAX INVOICE" title must not appear on a composition dealer's Bill of Supply.
  const isComposition = setting?.taxScheme === "composition";
  const baseTitle = isComposition ? "BILL OF SUPPLY" : setting?.invoiceTitle || "TAX INVOICE";

  try {
    const pdfBuffer = await generateGSTInvoicePDF({
      invoiceNumber: invoice.invoiceNumber,
      orderNumber: invoice.shopifyOrderNumber,
      invoiceDate: new Date(invoice.invoiceDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
      financialYear: invoice.financialYear,
      seller: {
        legalName: setting?.legalName || "Seller Trade Name",
        tradeName: setting?.tradeName || "",
        gstin: setting?.gstin || "N/A",
        pan: setting?.panNumber || "",
        address: [setting?.addressLine1, setting?.addressLine2].filter(Boolean).join(", "),
        city: setting?.city || "City",
        state: setting?.state || "State",
        stateCode: setting?.stateCode || "27",
        pincode: setting?.pincode || "400001",
        phone: setting?.phone || "",
        email: setting?.email || "",
      },
      buyer: {
        legalName: invoice.buyerTradeName || "Retail Customer (B2C)",
        tradeName: invoice.buyerTradeName || "",
        gstin: invoice.buyerGstin || undefined,
        address: [shipTo?.address1, shipTo?.address2, shipTo?.city, shipTo?.zip].filter(Boolean).join(", "),
        phone: invoice.buyerPhone || undefined,
        email: invoice.buyerEmail || undefined,
        state: cleanStateName(invoice.placeOfSupplyState),
        stateCode: invoice.placeOfSupplyCode,
      },
      placeOfSupply: `${invoice.placeOfSupplyCode}-${cleanStateName(invoice.placeOfSupplyState)}`,
      isInterState: invoice.isInterState,
      lineItems: invoice.lineItems.map((item) => ({
        title: item.title,
        hsnCode: item.hsnCode,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discountAmount,
        taxableValue: item.taxableValue,
        gstRate: item.gstRate,
        cgstAmount: item.cgstAmount,
        sgstAmount: item.sgstAmount,
        igstAmount: item.igstAmount,
        totalAmount: item.totalAmount,
      })),
      subtotalTaxable: invoice.subtotalTaxable,
      cgstTotal: invoice.cgstTotal,
      sgstTotal: invoice.sgstTotal,
      igstTotal: invoice.igstTotal,
      roundOff: invoice.roundOffAmount,
      grandTotal: invoice.grandTotal,
      ...(await brandingFromSettings(setting)),
      template: (new URL(request.url).searchParams.get("template") as string) || (invoice as any).templateUsed || setting?.invoiceTemplate || "standard_b2b",
      ewayBillRequired: (invoice as any).ewayBillRequired || false,
      customization: {
        invoiceTitle: `${invoice.status === "CANCELLED" ? "CANCELLED - " : ""}${baseTitle}`,
        invoiceSubtitle: isComposition
          ? "Composition taxable person, not eligible to collect tax on supplies"
          : setting?.invoiceSubtitle || undefined,
        signatureLabel: setting?.signatureLabel || undefined,
        footerNote: setting?.footerNote || undefined,
      },
    });

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoice.invoiceNumber.replace(/\//g, "-")}.pdf"`,
        "Content-Security-Policy": "frame-ancestors https://admin.shopify.com https://*.myshopify.com 'self'",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: any) {
    console.error("PDF generation error for invoice", invoiceId, error);
    return new Response(`Failed to generate PDF: ${error?.message || error}`, { status: 500 });
  }
};
