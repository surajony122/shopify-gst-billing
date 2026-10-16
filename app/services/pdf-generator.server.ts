import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";

export interface InvoicePDFData {
  invoiceNumber: string;
  orderNumber: string;
  invoiceDate: string;
  financialYear: string;
  seller: {
    legalName: string;
    tradeName?: string;
    gstin: string;
    pan?: string;
    address: string;
    city: string;
    state: string;
    stateCode: string;
    pincode: string;
    phone?: string;
    email?: string;
  };
  buyer: {
    legalName: string;
    tradeName?: string;
    gstin?: string;
    address: string;
    state: string;
    stateCode: string;
  };
  placeOfSupply: string;
  isInterState: boolean;
  lineItems: Array<{
    title: string;
    hsnCode: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxableValue: number;
    gstRate: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalAmount: number;
  }>;
  subtotalTaxable: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  roundOff: number;
  grandTotal: number;
  bankDetails?: {
    bankName?: string;
    accountNo?: string;
    ifsc?: string;
    upiId?: string;
  };
  terms?: string;
  template?: string; // "standard_b2b" | "modern_d2c" | "thermal_pos"
  brandColor?: string;
  taxScheme?: string; // "regular" | "composition"
}

/**
 * Convert number to Indian Currency words (Rupees in Lakhs & Crores)
 */
export function numberToIndianWords(num: number): string {
  const a = [
    "", "One ", "Two ", "Three ", "Four ", "Five ", "Six ", "Seven ", "Eight ", "Nine ", "Ten ",
    "Eleven ", "Twelve ", "Thirteen ", "Fourteen ", "Fifteen ", "Sixteen ", "Seventeen ", "Eighteen ", "Nineteen "
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const integer = Math.floor(Math.abs(num));
  if (integer === 0) return "Zero Rupees Only";

  function convertTwoDigits(n: number): string {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 !== 0 ? " " + a[n % 10] : " ");
  }

  let str = "";
  const crore = Math.floor(integer / 10000000);
  const lakh = Math.floor((integer % 10000000) / 100000);
  const thousand = Math.floor((integer % 100000) / 1000);
  const hundred = Math.floor((integer % 1000) / 100);
  const remaining = integer % 100;

  if (crore > 0) str += convertTwoDigits(crore) + "Crore ";
  if (lakh > 0) str += convertTwoDigits(lakh) + "Lakh ";
  if (thousand > 0) str += convertTwoDigits(thousand) + "Thousand ";
  if (hundred > 0) str += a[hundred] + "Hundred ";
  if (remaining > 0) str += (str !== "" ? "and " : "") + convertTwoDigits(remaining);

  return str.trim() + " Rupees Only";
}

function hexToRgb(hex: string = "#212B36"): [number, number, number] {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return [33, 43, 54];
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Generate a Rule 46 Compliant GST Tax Invoice PDF with Multi-Template Support
 */
export async function generateGSTInvoicePDF(data: InvoicePDFData): Promise<Buffer> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  const brandRgb = hexToRgb(data.brandColor || "#212B36");
  const isComposition = data.taxScheme === "composition";
  const template = data.template || "standard_b2b";

  if (template === "modern_d2c") {
    // Modern D2C Header Banner with brand color
    doc.setFillColor(brandRgb[0], brandRgb[1], brandRgb[2]);
    doc.rect(0, 0, pageWidth, 28, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text(isComposition ? "BILL OF SUPPLY" : "TAX INVOICE", 14, 15);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(230, 230, 230);
    doc.text(
      isComposition
        ? "Composition taxable person, not eligible to collect tax on supplies"
        : "Original for Recipient | Rule 46 CGST Act",
      14,
      21
    );

    y = 35;
  } else {
    // Standard Traditional B2B Format
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(brandRgb[0], brandRgb[1], brandRgb[2]);
    doc.text(isComposition ? "BILL OF SUPPLY" : "TAX INVOICE", pageWidth / 2, y, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(
      isComposition
        ? "Composition taxable person, not eligible to collect tax on supplies"
        : "(Issued under Rule 46 of the CGST Rules, 2017)",
      pageWidth / 2,
      y + 4,
      { align: "center" }
    );
    y += 10;

    // Outer border for traditional format
    doc.setDrawColor(brandRgb[0], brandRgb[1], brandRgb[2]);
    doc.setLineWidth(0.3);
    doc.line(14, y, pageWidth - 14, y);
    y += 5;
  }

  // 2-Column Header: Seller Info (Left) vs Invoice Details (Right)
  const leftX = 14;
  const rightX = 115;

  // Seller Details
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(data.seller.legalName || data.seller.tradeName || "SELLER COMPANY", leftX, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);
  let sellerY = y + 4.5;
  if (data.seller.address) {
    doc.text(data.seller.address, leftX, sellerY);
    sellerY += 4;
  }
  doc.text(`${data.seller.city || ""}, ${data.seller.state || ""} - ${data.seller.pincode || ""}`, leftX, sellerY);
  sellerY += 4;
  doc.setFont("helvetica", "bold");
  doc.text(`GSTIN: ${data.seller.gstin || "N/A"}`, leftX, sellerY);
  sellerY += 4;
  doc.setFont("helvetica", "normal");
  doc.text(`State: ${data.seller.state} (Code: ${data.seller.stateCode})`, leftX, sellerY);

  // Invoice Details (Right Column)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(`Invoice No: ${data.invoiceNumber}`, rightX, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);
  doc.text(`Invoice Date: ${data.invoiceDate}`, rightX, y + 4.5);
  doc.text(`Order No: #${data.orderNumber}`, rightX, y + 8.5);
  doc.text(`Place of Supply: ${data.placeOfSupply}`, rightX, y + 12.5);
  doc.text(`Reverse Charge: No`, rightX, y + 16.5);

  y = Math.max(sellerY, y + 20) + 4;

  // Buyer Details Box
  doc.setFillColor(248, 249, 250);
  doc.rect(14, y, pageWidth - 28, 22, "F");
  doc.setDrawColor(230, 230, 230);
  doc.rect(14, y, pageWidth - 28, 22, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  doc.text("BILLED TO / RECIPIENT:", leftX + 3, y + 5);

  doc.setFont("helvetica", "bold");
  doc.text(data.buyer.legalName || data.buyer.tradeName || "Retail Customer (B2C)", leftX + 3, y + 10);

  doc.setFont("helvetica", "normal");
  doc.text(data.buyer.address || "As per order shipping address", leftX + 3, y + 14);

  if (data.buyer.gstin) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 100, 0);
    doc.text(`BUYER GSTIN: ${data.buyer.gstin}`, rightX, y + 10);
  } else {
    doc.setTextColor(120, 120, 120);
    doc.text("Type: Unregistered Consumer (B2C)", rightX, y + 10);
  }
  doc.setFont("helvetica", "normal");
  doc.setTextColor(60, 60, 60);
  doc.text(`State: ${data.buyer.state} (Code: ${data.buyer.stateCode})`, rightX, y + 14);

  y += 26;

  // Line Items Table using autoTable
  const tableHeaders = data.isInterState
    ? [["#", "Item Description", "HSN/SAC", "Qty", "Rate", "Taxable", "IGST %", "IGST Amt", "Total (INR)"]]
    : [["#", "Item Description", "HSN/SAC", "Qty", "Rate", "Taxable", "CGST", "SGST", "Total (INR)"]];

  const tableBody = data.lineItems.map((item, index) => {
    if (data.isInterState) {
      return [
        index + 1,
        item.title,
        item.hsnCode,
        item.quantity,
        item.unitPrice.toFixed(2),
        item.taxableValue.toFixed(2),
        `${item.gstRate}%`,
        item.igstAmount.toFixed(2),
        item.totalAmount.toFixed(2),
      ];
    } else {
      return [
        index + 1,
        item.title,
        item.hsnCode,
        item.quantity,
        item.unitPrice.toFixed(2),
        item.taxableValue.toFixed(2),
        item.cgstAmount.toFixed(2),
        item.sgstAmount.toFixed(2),
        item.totalAmount.toFixed(2),
      ];
    }
  });

  autoTable(doc, {
    startY: y,
    head: tableHeaders,
    body: tableBody,
    theme: "striped",
    headStyles: {
      fillColor: brandRgb,
      textColor: [255, 255, 255],
      fontSize: 8,
      halign: "center",
    },
    styles: {
      fontSize: 8,
      cellPadding: 2,
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 8 },
      1: { cellWidth: 55 },
      2: { halign: "center", cellWidth: 18 },
      3: { halign: "center", cellWidth: 12 },
      4: { halign: "right", cellWidth: 18 },
      5: { halign: "right", cellWidth: 20 },
      6: { halign: "right", cellWidth: 16 },
      7: { halign: "right", cellWidth: 16 },
      8: { halign: "right", cellWidth: 22 },
    },
    margin: { left: 14, right: 14 },
  });

  // Calculate table end Y
  // @ts-ignore
  let finalY = doc.lastAutoTable.finalY + 5;

  // Financial Totals Summary (Right-aligned)
  const totalsX = 135;
  const totalsValX = pageWidth - 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);

  doc.text("Taxable Amount:", totalsX, finalY);
  doc.text(`₹ ${data.subtotalTaxable.toFixed(2)}`, totalsValX, finalY, { align: "right" });
  finalY += 4.5;

  if (data.isInterState) {
    doc.text("IGST Total:", totalsX, finalY);
    doc.text(`₹ ${data.igstTotal.toFixed(2)}`, totalsValX, finalY, { align: "right" });
    finalY += 4.5;
  } else {
    doc.text("CGST Total:", totalsX, finalY);
    doc.text(`₹ ${data.cgstTotal.toFixed(2)}`, totalsValX, finalY, { align: "right" });
    finalY += 4.5;
    doc.text("SGST Total:", totalsX, finalY);
    doc.text(`₹ ${data.sgstTotal.toFixed(2)}`, totalsValX, finalY, { align: "right" });
    finalY += 4.5;
  }

  if (data.roundOff !== 0) {
    doc.text("Round-off (Sec 170):", totalsX, finalY);
    doc.text(`₹ ${data.roundOff.toFixed(2)}`, totalsValX, finalY, { align: "right" });
    finalY += 4.5;
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(totalsX, finalY, pageWidth - 14, finalY);
  finalY += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text("Grand Total:", totalsX, finalY);
  doc.text(`₹ ${data.grandTotal.toFixed(2)}`, totalsValX, finalY, { align: "right" });

  // Amount in Words
  finalY += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(33, 43, 54);
  doc.text("Amount in Words:", 14, finalY);
  doc.setFont("helvetica", "normal");
  doc.text(numberToIndianWords(data.grandTotal), 42, finalY);

  // Bank Details & Signatory Footer
  finalY += 12;
  doc.setDrawColor(230, 230, 230);
  doc.line(14, finalY, pageWidth - 14, finalY);
  finalY += 6;

  // Bank Info (Left)
  if (data.bankDetails?.accountNo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Bank Transfer Details:", 14, finalY);
    doc.setFont("helvetica", "normal");
    doc.text(`Bank: ${data.bankDetails.bankName || "N/A"}`, 14, finalY + 4);
    doc.text(`A/C No: ${data.bankDetails.accountNo}`, 14, finalY + 8);
    doc.text(`IFSC: ${data.bankDetails.ifsc || "N/A"}`, 14, finalY + 12);
  }

  // Signatory (Right)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(`For ${data.seller.legalName || data.seller.tradeName}`, pageWidth - 14, finalY, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text("(Authorized Signatory)", pageWidth - 14, finalY + 16, { align: "right" });

  // Return PDF buffer
  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
