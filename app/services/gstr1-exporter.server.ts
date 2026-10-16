import * as XLSX from "xlsx";

export interface GSTR1InvoiceRecord {
  invoiceNumber: string;
  invoiceDate: string;
  orderNumber: string;
  isB2B: boolean;
  buyerGstin?: string;
  buyerTradeName?: string;
  placeOfSupplyCode: string;
  placeOfSupplyState: string;
  isInterState: boolean;
  taxableValue: number;
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  totalInvoiceValue: number;
  hsnCode: string;
  quantity: number;
}

/**
 * Generate CA-Ready GSTR-1 Multi-Sheet Excel Workbook
 */
export function generateGSTR1Workbook(invoices: GSTR1InvoiceRecord[]): Buffer {
  const wb = XLSX.utils.book_new();

  // 1. Sheet: B2B (Tax Invoices to Registered Persons)
  const b2bRows = invoices
    .filter((inv) => inv.isB2B && inv.buyerGstin)
    .map((inv) => ({
      "GSTIN/UIN of Recipient": inv.buyerGstin,
      "Receiver Name": inv.buyerTradeName || "Business",
      "Invoice Number": inv.invoiceNumber,
      "Invoice Date": inv.invoiceDate,
      "Invoice Value": inv.totalInvoiceValue,
      "Place Of Supply": `${inv.placeOfSupplyCode}-${inv.placeOfSupplyState}`,
      "Reverse Charge": "N",
      "Applicable % of Tax Rate": "",
      "Invoice Type": "Regular",
      "E-Commerce GSTIN": "",
      "Rate": inv.gstRate,
      "Taxable Value": inv.taxableValue,
      "Cess Amount": inv.cessAmount,
    }));
  const b2bSheet = XLSX.utils.json_to_sheet(b2bRows);
  XLSX.utils.book_append_sheet(wb, b2bSheet, "b2b");

  // 2. Sheet: B2CL (B2C Large - Inter-State > 2.5 Lakhs)
  const b2clRows = invoices
    .filter((inv) => !inv.isB2B && inv.isInterState && inv.totalInvoiceValue > 250000)
    .map((inv) => ({
      "Invoice Number": inv.invoiceNumber,
      "Invoice Date": inv.invoiceDate,
      "Invoice Value": inv.totalInvoiceValue,
      "Place Of Supply": `${inv.placeOfSupplyCode}-${inv.placeOfSupplyState}`,
      "Applicable % of Tax Rate": "",
      "Rate": inv.gstRate,
      "Taxable Value": inv.taxableValue,
      "Cess Amount": inv.cessAmount,
      "E-Commerce GSTIN": "",
    }));
  const b2clSheet = XLSX.utils.json_to_sheet(b2clRows);
  XLSX.utils.book_append_sheet(wb, b2clSheet, "b2cl");

  // 3. Sheet: B2CS (B2C Small - State-wise & Rate-wise Summary)
  const b2csMap = new Map<string, { pos: string; rate: number; taxable: number; cess: number }>();
  invoices
    .filter((inv) => !inv.isB2B && (!inv.isInterState || inv.totalInvoiceValue <= 250000))
    .forEach((inv) => {
      const key = `${inv.placeOfSupplyCode}_${inv.gstRate}`;
      const existing = b2csMap.get(key) || {
        pos: `${inv.placeOfSupplyCode}-${inv.placeOfSupplyState}`,
        rate: inv.gstRate,
        taxable: 0,
        cess: 0,
      };
      existing.taxable += inv.taxableValue;
      existing.cess += inv.cessAmount;
      b2csMap.set(key, existing);
    });

  const b2csRows = Array.from(b2csMap.values()).map((row) => ({
    "Type": "OE", // Other than E-Commerce
    "Place Of Supply": row.pos,
    "Applicable % of Tax Rate": "",
    "Rate": row.rate,
    "Taxable Value": Number(row.taxable.toFixed(2)),
    "Cess Amount": Number(row.cess.toFixed(2)),
    "E-Commerce GSTIN": "",
  }));
  const b2csSheet = XLSX.utils.json_to_sheet(b2csRows);
  XLSX.utils.book_append_sheet(wb, b2csSheet, "b2cs");

  // 4. Sheet: HSN Summary
  const hsnMap = new Map<string, { hsn: string; desc: string; uqc: string; qty: number; val: number; tax: number; igst: number; cgst: number; sgst: number; cess: number }>();
  invoices.forEach((inv) => {
    const key = `${inv.hsnCode}_${inv.gstRate}`;
    const existing = hsnMap.get(key) || {
      hsn: inv.hsnCode,
      desc: "Goods/Services",
      uqc: "NOS",
      qty: 0,
      val: 0,
      tax: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
    };
    existing.qty += inv.quantity;
    existing.val += inv.totalInvoiceValue;
    existing.tax += inv.taxableValue;
    existing.igst += inv.igstAmount;
    existing.cgst += inv.cgstAmount;
    existing.sgst += inv.sgstAmount;
    existing.cess += inv.cessAmount;
    hsnMap.set(key, existing);
  });

  const hsnRows = Array.from(hsnMap.values()).map((h) => ({
    "HSN": h.hsn,
    "Description": h.desc,
    "UQC": h.uqc,
    "Total Quantity": h.qty,
    "Total Value": Number(h.val.toFixed(2)),
    "Taxable Value": Number(h.tax.toFixed(2)),
    "Integrated Tax Amount": Number(h.igst.toFixed(2)),
    "Central Tax Amount": Number(h.cgst.toFixed(2)),
    "State/UT Tax Amount": Number(h.sgst.toFixed(2)),
    "Cess Amount": Number(h.cess.toFixed(2)),
  }));
  const hsnSheet = XLSX.utils.json_to_sheet(hsnRows);
  XLSX.utils.book_append_sheet(wb, hsnSheet, "hsn");

  // Return binary buffer
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
