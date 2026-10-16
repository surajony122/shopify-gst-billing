import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";

function runAutoTable(doc: any, options: any) {
  if (typeof autoTable === "function") {
    autoTable(doc, options);
  } else if (typeof (autoTable as any)?.default === "function") {
    (autoTable as any).default(doc, options);
  } else if (typeof doc.autoTable === "function") {
    doc.autoTable(options);
  } else {
    throw new Error("jspdf-autotable could not be initialized");
  }
}

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
  template?: string; // "standard_b2b" | "modern_d2c" | "minimalist" | "thermal_pos"
  ewayBillRequired?: boolean;
  customization?: {
    invoiceTitle?: string;
    invoiceSubtitle?: string;
    showBankDetails?: boolean;
    showTerms?: boolean;
    signatureLabel?: string;
    footerNote?: string;
  };
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
 * 80mm Compact Thermal Receipt / Packing Slip Generator
 */
async function generateThermalPOSPDF(data: InvoicePDFData): Promise<Buffer> {
  // 80mm roll width, dynamic height estimation based on line item count
  const estimatedHeight = Math.max(180, 110 + data.lineItems.length * 12);
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: [80, estimatedHeight],
  });

  const isComposition = data.taxScheme === "composition";
  let y = 8;

  // Header
  doc.setFont("courier", "bold");
  doc.setFontSize(11);
  doc.text(data.seller.tradeName || data.seller.legalName || "STORE", 40, y, { align: "center" });
  y += 4.5;

  doc.setFont("courier", "normal");
  doc.setFontSize(7);
  if (data.seller.address) {
    doc.text(data.seller.address.substring(0, 42), 40, y, { align: "center" });
    y += 3.5;
  }
  doc.text(`${data.seller.city || ""}, ${data.seller.state || ""} - ${data.seller.pincode || ""}`, 40, y, { align: "center" });
  y += 3.5;
  doc.text(`GSTIN: ${data.seller.gstin || "N/A"}`, 40, y, { align: "center" });
  y += 4;

  doc.setFont("courier", "bold");
  doc.setFontSize(8.5);
  doc.text(isComposition ? "*** BILL OF SUPPLY ***" : "*** TAX INVOICE ***", 40, y, { align: "center" });
  y += 4;

  // Dashed separator
  doc.setFont("courier", "normal");
  doc.setFontSize(7.5);
  doc.text("------------------------------------------", 40, y, { align: "center" });
  y += 4;

  doc.setFontSize(7);
  doc.text(`Inv No: ${data.invoiceNumber}`, 4, y);
  y += 3.5;
  doc.text(`Date  : ${data.invoiceDate} | Order: #${data.orderNumber}`, 4, y);
  y += 3.5;
  doc.text(`Buyer : ${(data.buyer.legalName || "Retail Customer").substring(0, 32)}`, 4, y);
  if (data.buyer.gstin) {
    y += 3.5;
    doc.text(`GSTIN : ${data.buyer.gstin}`, 4, y);
  }
  y += 3.5;
  doc.text(`POS   : ${data.placeOfSupply}`, 4, y);
  y += 4;

  doc.text("------------------------------------------", 40, y, { align: "center" });
  y += 2;

  // Compact Items Table
  const tableHeaders = [["Item", "HSN", "Qty", "Price", "Total"]];
  const tableBody = data.lineItems.map((item) => [
    item.title.substring(0, 18),
    item.hsnCode,
    item.quantity,
    item.unitPrice.toFixed(0),
    item.totalAmount.toFixed(0),
  ]);

  runAutoTable(doc, {
    startY: y,
    head: tableHeaders,
    body: tableBody,
    theme: "plain",
    styles: {
      font: "courier",
      fontSize: 6.5,
      cellPadding: 1,
    },
    headStyles: {
      fontStyle: "bold",
      fillColor: [240, 240, 240],
    },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 12, halign: "center" },
      2: { cellWidth: 8, halign: "center" },
      3: { cellWidth: 12, halign: "right" },
      4: { cellWidth: 14, halign: "right" },
    },
    margin: { left: 4, right: 4 },
  });

  // @ts-ignore
  let finalY = doc.lastAutoTable.finalY + 3;

  doc.setFont("courier", "normal");
  doc.setFontSize(7.5);
  doc.text("------------------------------------------", 40, finalY, { align: "center" });
  finalY += 4;

  doc.text("Taxable Value :", 4, finalY);
  doc.text(`INR ${data.subtotalTaxable.toFixed(2)}`, 76, finalY, { align: "right" });
  finalY += 3.5;

  if (data.isInterState) {
    doc.text("IGST Total    :", 4, finalY);
    doc.text(`INR ${data.igstTotal.toFixed(2)}`, 76, finalY, { align: "right" });
    finalY += 3.5;
  } else {
    doc.text("CGST Total    :", 4, finalY);
    doc.text(`INR ${data.cgstTotal.toFixed(2)}`, 76, finalY, { align: "right" });
    finalY += 3.5;
    doc.text("SGST Total    :", 4, finalY);
    doc.text(`INR ${data.sgstTotal.toFixed(2)}`, 76, finalY, { align: "right" });
    finalY += 3.5;
  }

  if (data.roundOff !== 0) {
    doc.text("Round-off     :", 4, finalY);
    doc.text(`INR ${data.roundOff.toFixed(2)}`, 76, finalY, { align: "right" });
    finalY += 3.5;
  }

  doc.text("==========================================", 40, finalY, { align: "center" });
  finalY += 4.5;

  doc.setFont("courier", "bold");
  doc.setFontSize(9);
  doc.text("NET TOTAL     :", 4, finalY);
  doc.text(`INR ${data.grandTotal.toFixed(2)}`, 76, finalY, { align: "right" });
  finalY += 6;

  // QR Code for UPI if available
  if (data.bankDetails?.upiId) {
    try {
      const upiUrl = `upi://pay?pa=${data.bankDetails.upiId}&pn=${encodeURIComponent(data.seller.legalName)}&am=${data.grandTotal}&cu=INR`;
      const qrDataUrl = await QRCode.toDataURL(upiUrl, { width: 80, margin: 1 });
      doc.addImage(qrDataUrl, "PNG", 30, finalY, 20, 20);
      finalY += 23;
      doc.setFont("courier", "normal");
      doc.setFontSize(6.5);
      doc.text(`Scan to Pay UPI: ${data.bankDetails.upiId}`, 40, finalY, { align: "center" });
      finalY += 4;
    } catch (e) {
      // Ignore QR errors
    }
  }

  doc.setFont("courier", "normal");
  doc.setFontSize(7);
  doc.text("Thank You for Shopping With Us!", 40, finalY, { align: "center" });

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

/**
 * Minimalist Studio Template (Monochrome, Elegant Typography & Hairline Dividers)
 */
async function generateMinimalistPDF(data: InvoicePDFData): Promise<Buffer> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const isComposition = data.taxScheme === "composition";
  let y = 18;

  // Minimal Header: Brand Name (Left), Invoice Tag (Right)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(20, 20, 20);
  doc.text(data.seller.legalName || data.seller.tradeName || "STUDIO", 16, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  doc.setTextColor(80, 80, 80);
  doc.text(isComposition ? "BILL OF SUPPLY" : "INVOICE", pageWidth - 16, y, { align: "right" });
  y += 5;

  doc.setFontSize(8);
  doc.setTextColor(130, 130, 130);
  doc.text(isComposition ? "Composition Dealer" : "Rule 46 CGST Act", pageWidth - 16, y, { align: "right" });
  y += 7;

  // Thin Hairline Divider
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.2);
  doc.line(16, y, pageWidth - 16, y);
  y += 6;

  // Metadata Grid
  const col1 = 16;
  const col2 = 65;
  const col3 = 120;
  const col4 = 160;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text("INVOICE NUMBER", col1, y);
  doc.text("DATE OF ISSUE", col2, y);
  doc.text("ORDER NUMBER", col3, y);
  doc.text("PLACE OF SUPPLY", col4, y);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(20, 20, 20);
  doc.text(data.invoiceNumber, col1, y);
  doc.text(data.invoiceDate, col2, y);
  doc.text(`#${data.orderNumber}`, col3, y);
  doc.text(data.placeOfSupply, col4, y);
  y += 8;

  // Seller & Buyer 2-Column Section
  doc.line(16, y, pageWidth - 16, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text("ISSUED BY", col1, y);
  doc.text("BILLED TO", col3, y);
  y += 4.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(20, 20, 20);
  doc.text(data.seller.tradeName || data.seller.legalName, col1, y);
  doc.text(data.buyer.legalName || data.buyer.tradeName || "Retail Customer (B2C)", col3, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(`GSTIN: ${data.seller.gstin || "N/A"}`, col1, y);
  doc.text(data.buyer.gstin ? `GSTIN: ${data.buyer.gstin}` : "Unregistered Consumer", col3, y);
  y += 3.8;

  doc.text(`${data.seller.city || ""}, ${data.seller.state || ""}`, col1, y);
  doc.text(`${data.buyer.state} (Code: ${data.buyer.stateCode})`, col3, y);
  y += 7;

  // Clean Minimalist Table
  const tableHeaders = data.isInterState
    ? [["Item", "HSN", "Qty", "Rate", "Taxable", "IGST %", "IGST", "Total"]]
    : [["Item", "HSN", "Qty", "Rate", "Taxable", "CGST", "SGST", "Total"]];

  const tableBody = data.lineItems.map((item) => {
    if (data.isInterState) {
      return [
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

  runAutoTable(doc, {
    startY: y,
    head: tableHeaders,
    body: tableBody,
    theme: "plain",
    headStyles: {
      fillColor: [248, 249, 250],
      textColor: [50, 50, 50],
      fontStyle: "bold",
      fontSize: 8,
    },
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [40, 40, 40],
      lineColor: [235, 235, 235],
      lineWidth: { bottom: 0.15 },
    },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { halign: "center", cellWidth: 18 },
      2: { halign: "center", cellWidth: 12 },
      3: { halign: "right", cellWidth: 18 },
      4: { halign: "right", cellWidth: 20 },
      5: { halign: "right", cellWidth: 16 },
      6: { halign: "right", cellWidth: 16 },
      7: { halign: "right", cellWidth: 20 },
    },
    margin: { left: 16, right: 16 },
  });

  // @ts-ignore
  let finalY = doc.lastAutoTable.finalY + 6;

  // Minimalist Totals
  const totalsLabelX = 130;
  const totalsValueX = pageWidth - 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(100, 100, 100);

  doc.text("Taxable Subtotal", totalsLabelX, finalY);
  doc.text(`Rs. ${data.subtotalTaxable.toFixed(2)}`, totalsValueX, finalY, { align: "right" });
  finalY += 4.5;

  if (data.isInterState) {
    doc.text("IGST Total", totalsLabelX, finalY);
    doc.text(`Rs. ${data.igstTotal.toFixed(2)}`, totalsValueX, finalY, { align: "right" });
    finalY += 4.5;
  } else {
    doc.text("CGST Total", totalsLabelX, finalY);
    doc.text(`Rs. ${data.cgstTotal.toFixed(2)}`, totalsValueX, finalY, { align: "right" });
    finalY += 4.5;
    doc.text("SGST Total", totalsLabelX, finalY);
    doc.text(`Rs. ${data.sgstTotal.toFixed(2)}`, totalsValueX, finalY, { align: "right" });
    finalY += 4.5;
  }

  if (data.roundOff !== 0) {
    doc.text("Round-off (Sec 170)", totalsLabelX, finalY);
    doc.text(`Rs. ${data.roundOff.toFixed(2)}`, totalsValueX, finalY, { align: "right" });
    finalY += 4.5;
  }

  doc.setDrawColor(220, 220, 220);
  doc.line(totalsLabelX, finalY, totalsValueX, finalY);
  finalY += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text("Total Amount", totalsLabelX, finalY);
  doc.text(`Rs. ${data.grandTotal.toFixed(2)}`, totalsValueX, finalY, { align: "right" });
  finalY += 8;

  // Words & Footnote
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text(`Amount in words: ${numberToIndianWords(data.grandTotal)}`, 16, finalY);
  finalY += 12;

  // Footer Divider & Bank Details
  doc.line(16, finalY, pageWidth - 16, finalY);
  finalY += 6;

  if (data.bankDetails?.accountNo) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(90, 90, 90);
    doc.text(`Bank: ${data.bankDetails.bankName || "N/A"}  |  A/C: ${data.bankDetails.accountNo}  |  IFSC: ${data.bankDetails.ifsc || "N/A"}${data.bankDetails.upiId ? `  |  UPI: ${data.bankDetails.upiId}` : ""}`, 16, finalY);
  }

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

/**
 * Generate a Rule 46 Compliant GST Tax Invoice PDF with Multi-Template Support
 */
export async function generateGSTInvoicePDF(data: InvoicePDFData): Promise<Buffer> {
  const template = data.template || "standard_b2b";

  if (template === "thermal_pos") {
    return generateThermalPOSPDF(data);
  }

  if (template === "minimalist") {
    return generateMinimalistPDF(data);
  }

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  const brandRgb = hexToRgb(data.brandColor || "#212B36");
  const isComposition = data.taxScheme === "composition";
  const docTitle = data.customization?.invoiceTitle || (isComposition ? "BILL OF SUPPLY" : "TAX INVOICE");
  const docSubtitle = data.customization?.invoiceSubtitle || (isComposition
    ? "Composition taxable person, not eligible to collect tax on supplies"
    : "(Issued under Rule 46 of the CGST Rules, 2017 - Original for Recipient)");

  if (template === "modern_d2c") {
    // Modern D2C Header Banner with brand color
    doc.setFillColor(brandRgb[0], brandRgb[1], brandRgb[2]);
    doc.rect(0, 0, pageWidth, 28, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text(docTitle, 14, 15);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(230, 230, 230);
    doc.text(docSubtitle, 14, 21);

    y = 35;
  } else {
    // Standard Traditional B2B Format
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(brandRgb[0], brandRgb[1], brandRgb[2]);
    doc.text(docTitle, pageWidth / 2, y, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(docSubtitle, pageWidth / 2, y + 4, { align: "center" });
    y += 10;

    // Outer border line for traditional format
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

  if (data.ewayBillRequired) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(180, 40, 20);
    doc.text("e-Way Bill Required (Consignment > Rs. 50,000)", rightX, y + 20.5);
  }

  y = Math.max(sellerY, y + 24) + 2;

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

  runAutoTable(doc, {
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

  // @ts-ignore
  let finalY = doc.lastAutoTable.finalY + 5;

  // Financial Totals Summary (Right-aligned)
  const totalsX = 135;
  const totalsValX = pageWidth - 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);

  doc.text("Taxable Amount:", totalsX, finalY);
  doc.text(`Rs. ${data.subtotalTaxable.toFixed(2)}`, totalsValX, finalY, { align: "right" });
  finalY += 4.5;

  if (data.isInterState) {
    doc.text("IGST Total:", totalsX, finalY);
    doc.text(`Rs. ${data.igstTotal.toFixed(2)}`, totalsValX, finalY, { align: "right" });
    finalY += 4.5;
  } else {
    doc.text("CGST Total:", totalsX, finalY);
    doc.text(`Rs. ${data.cgstTotal.toFixed(2)}`, totalsValX, finalY, { align: "right" });
    finalY += 4.5;
    doc.text("SGST Total:", totalsX, finalY);
    doc.text(`Rs. ${data.sgstTotal.toFixed(2)}`, totalsValX, finalY, { align: "right" });
    finalY += 4.5;
  }

  if (data.roundOff !== 0) {
    doc.text("Round-off (Sec 170):", totalsX, finalY);
    doc.text(`Rs. ${data.roundOff.toFixed(2)}`, totalsValX, finalY, { align: "right" });
    finalY += 4.5;
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(totalsX, finalY, pageWidth - 14, finalY);
  finalY += 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text("Grand Total:", totalsX, finalY);
  doc.text(`Rs. ${data.grandTotal.toFixed(2)}`, totalsValX, finalY, { align: "right" });

  // Amount in Words
  finalY += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(33, 43, 54);
  doc.text("Amount in Words:", 14, finalY);
  doc.setFont("helvetica", "normal");
  doc.text(numberToIndianWords(data.grandTotal), 42, finalY);

  // Bank Details, Signatory & UPI QR
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

  // Dynamic UPI QR code if UPI ID is configured
  if (data.bankDetails?.upiId) {
    try {
      const upiUrl = `upi://pay?pa=${data.bankDetails.upiId}&pn=${encodeURIComponent(data.seller.legalName)}&am=${data.grandTotal}&cu=INR`;
      const qrDataUrl = await QRCode.toDataURL(upiUrl, { width: 100, margin: 1 });
      doc.addImage(qrDataUrl, "PNG", 85, finalY - 2, 22, 22);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(100, 100, 100);
      doc.text("Scan UPI to Pay", 96, finalY + 23, { align: "center" });
    } catch (e) {
      // Ignore QR errors
    }
  }

  // Signatory (Right)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(`For ${data.seller.legalName || data.seller.tradeName}`, pageWidth - 14, finalY, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text("(Authorized Signatory)", pageWidth - 14, finalY + 16, { align: "right" });

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
