import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { generateGSTInvoicePDF } from "../services/pdf-generator.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const invoiceId = params.id;
  if (!invoiceId) {
    return new Response("Invoice ID required", { status: 400 });
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lineItems: true },
  });

  if (!invoice) {
    return new Response("Invoice not found", { status: 404 });
  }

  const setting = await prisma.storeSetting.findUnique({
    where: { shop: invoice.shop },
  });

  const pdfBuffer = await generateGSTInvoicePDF({
    invoiceNumber: invoice.invoiceNumber,
    orderNumber: invoice.shopifyOrderNumber,
    invoiceDate: new Date(invoice.invoiceDate).toLocaleDateString("en-IN"),
    financialYear: invoice.financialYear,
    seller: {
      legalName: setting?.legalName || "Seller Trade Name",
      tradeName: setting?.tradeName || "",
      gstin: setting?.gstin || "N/A",
      pan: setting?.panNumber || "",
      address: setting?.addressLine1 || "Warehouse Address",
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
      address: (invoice.shippingAddress as any)?.address1 || "Customer Address",
      state: invoice.placeOfSupplyState,
      stateCode: invoice.placeOfSupplyCode,
    },
    placeOfSupply: `${invoice.placeOfSupplyCode}-${invoice.placeOfSupplyState}`,
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
    bankDetails: {
      bankName: setting?.bankName || undefined,
      accountNo: setting?.bankAccountNo || undefined,
      ifsc: setting?.bankIfsc || undefined,
      upiId: setting?.upiId || undefined,
    },
    terms: setting?.termsAndConditions || undefined,
    template: setting?.invoiceTemplate || "standard_b2b",
    brandColor: setting?.brandColor || "#212B36",
    taxScheme: setting?.taxScheme || "regular",
  });

  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoiceNumber.replace(/\//g, "-")}.pdf"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
};
