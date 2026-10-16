import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateGSTInvoicePDF } from "../services/pdf-generator.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const template = url.searchParams.get("template") || "standard_b2b";

  const setting = await prisma.storeSetting.findUnique({
    where: { shop },
  });

  const pdfBuffer = await generateGSTInvoicePDF({
    invoiceNumber: "INV/SAMPLE/001",
    orderNumber: "1099",
    invoiceDate: new Date().toLocaleDateString("en-IN"),
    financialYear: "2026-27",
    seller: {
      legalName: setting?.legalName || "Sample Merchant Pvt Ltd",
      tradeName: setting?.tradeName || "My Store India",
      gstin: setting?.gstin || "27AABCU9603R1ZM",
      pan: setting?.panNumber || "AABCU9603R",
      address: setting?.addressLine1 || "123 Business Hub, MG Road",
      city: setting?.city || "Mumbai",
      state: setting?.state || "Maharashtra",
      stateCode: setting?.stateCode || "27",
      pincode: setting?.pincode || "400001",
      phone: "+91 98765 43210",
      email: "billing@mystore.in",
    },
    buyer: {
      legalName: "Apex Retailers LLP",
      tradeName: "Apex Stores",
      gstin: "29AABCA1234F1Z5",
      address: "45 Commercial Street, Indiranagar",
      state: "Karnataka",
      stateCode: "29",
    },
    placeOfSupply: "29-Karnataka",
    isInterState: true,
    lineItems: [
      {
        title: "Premium Cotton Oxford Shirt - Blue / L",
        hsnCode: "6205",
        quantity: 2,
        unitPrice: 1499.0,
        discount: 0,
        taxableValue: 2998.0,
        gstRate: 12.0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 359.76,
        totalAmount: 3357.76,
      },
      {
        title: "Ergonomic Desk Wireless Keyboard",
        hsnCode: "8471",
        quantity: 1,
        unitPrice: 2499.0,
        discount: 200.0,
        taxableValue: 2299.0,
        gstRate: 18.0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 413.82,
        totalAmount: 2712.82,
      },
      {
        title: "Standard Expedited Express Shipping",
        hsnCode: "9968",
        quantity: 1,
        unitPrice: 150.0,
        discount: 0,
        taxableValue: 150.0,
        gstRate: 18.0,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 27.0,
        totalAmount: 177.0,
      },
    ],
    subtotalTaxable: 5447.0,
    cgstTotal: 0,
    sgstTotal: 0,
    igstTotal: 800.58,
    roundOff: 0.42,
    grandTotal: 6248.0,
    bankDetails: {
      bankName: setting?.bankName || "HDFC Bank Ltd",
      accountNo: setting?.bankAccountNo || "50200012345678",
      ifsc: setting?.bankIfsc || "HDFC0001234",
      upiId: setting?.upiId || "merchant@upi",
    },
    terms: setting?.termsAndConditions || "Subject to local jurisdiction. Goods once sold cannot be returned without valid inspection.",
    template,
    brandColor: setting?.brandColor || "#212B36",
    taxScheme: setting?.taxScheme || "regular",
    ewayBillRequired: false,
  });

  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="sample-${template}-invoice.pdf"`,
      "Cache-Control": "no-cache",
    },
  });
};
