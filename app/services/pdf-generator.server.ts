import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { isAllowedLogoUrl } from "./gst-engine";

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

/** Downloads the merchant's logo. An invoice must still print if this fails, so errors give no logo. */
async function fetchLogoDataUrl(logoUrl?: string | null): Promise<string | undefined> {
  if (!logoUrl || !isAllowedLogoUrl(logoUrl)) return undefined;
  if (logoUrl.startsWith("data:")) return logoUrl;
  try {
    const response = await fetch(logoUrl, { signal: AbortSignal.timeout(5000) });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !/image\/(png|jpe?g)/.test(type)) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2_000_000) return undefined;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch (error) {
    console.warn("Could not load invoice logo", error);
    return undefined;
  }
}

/** Turns saved Template Editor settings into PDF options, so each switch applies to every template. */
export async function brandingFromSettings(setting: any) {
  const showBank = setting?.showBankDetails ?? true;
  const showUpi = setting?.showUpiQr ?? true;
  return {
    brandColor: setting?.brandColor || "#212B36",
    taxScheme: setting?.taxScheme || "regular",
    logoDataUrl: await fetchLogoDataUrl(setting?.logoUrl),
    signatureDataUrl: (setting?.showSignature ?? true) ? await fetchLogoDataUrl(setting?.signatureUrl) : undefined,
    terms: (setting?.showTerms ?? true) ? setting?.termsAndConditions || undefined : undefined,
    bankDetails: {
      bankName: showBank ? setting?.bankName || undefined : undefined,
      accountNo: showBank ? setting?.bankAccountNo || undefined : undefined,
      ifsc: showBank ? setting?.bankIfsc || undefined : undefined,
      upiId: showUpi ? setting?.upiId || undefined : undefined,
    },
  };
}

/** Draws the logo inside a box, keeping its proportions. Returns nothing if the image is unreadable. */
function drawImage(doc: any, image: string | undefined, x: number, y: number, maxWidth: number, maxHeight: number, align: "left" | "center" | "right" = "left"): number {
  if (!image) return 0;
  try {
    const format = image.includes("image/png") ? "PNG" : "JPEG";
    const { width, height } = doc.getImageProperties(image);
    const scale = Math.min(maxWidth / width, maxHeight / height);
    const drawWidth = width * scale;
    const drawX = align === "right" ? x - drawWidth : align === "center" ? x - drawWidth / 2 : x;
    doc.addImage(image, format, drawX, y, drawWidth, height * scale);
    return height * scale;
  } catch (error) {
    console.warn("Could not draw invoice image", error);
    return 0;
  }
}

function drawLogo(doc: any, data: InvoicePDFData, x: number, y: number, maxWidth: number, maxHeight: number, alignRight = false) {
  drawImage(doc, data.logoDataUrl, x, y, maxWidth, maxHeight, alignRight ? "right" : "left");
}

const inr = (value: number) =>
  value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SHIPPING_SAC = "996812";

/** White text on dark colors, near-black on light ones. */
const readableOn = ([r, g, b]: [number, number, number]): [number, number, number] =>
  0.299 * r + 0.587 * g + 0.114 * b > 160 ? [30, 30, 30] : [255, 255, 255];

/** The default A4 format: a single bordered sheet, as commonly used for Indian tax invoices. */
async function generateStandardPDF(data: InvoicePDFData): Promise<Buffer> {
  const doc: any = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 14;
  const right = pageWidth - 14;
  const pad = 3;
  const brandRgb = hexToRgb(data.brandColor || "#212B36");
  // A pale tint of the brand color, so dark text stays readable on table headings.
  const barColor = brandRgb.map((c) => Math.round(c * 0.12 + 255 * 0.88)) as [number, number, number];
  const isComposition = data.taxScheme === "composition";

  let y = 8;
  const logoHeight = drawImage(doc, data.logoDataUrl, pageWidth / 2, y, 70, 22, "center");
  y += logoHeight ? logoHeight + 3 : 2;
  const boxTop = y;

  const setText = (size: number, style: "normal" | "bold" = "normal", gray = 50) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(gray, gray, gray);
  };
  const rule = (atY: number) => {
    doc.setDrawColor(30, 30, 30);
    doc.setLineWidth(0.3);
    doc.line(left, atY, right, atY);
  };
  // Starts a new page when a section would not fit, so sections are never cut in half.
  const ensureSpace = (height: number) => {
    if (y + height > pageHeight - 10) {
      doc.addPage();
      y = 10;
      rule(y);
    }
  };

  // Title bar
  const title = data.customization?.invoiceTitle || (isComposition ? "BILL OF SUPPLY" : "TAX INVOICE");
  doc.setFillColor(...brandRgb);
  doc.rect(left, y, right - left, 9, "F");
  setText(10.5, "bold", 30);
  doc.setTextColor(...readableOn(brandRgb));
  doc.text(`${title} # ${data.invoiceNumber}`, left + pad, y + 6);
  doc.text(`Date : ${data.invoiceDate}`, right - pad, y + 6, { align: "right" });
  y += 9;
  rule(boxTop);
  rule(y);

  // Customer on the left, seller on the right
  const columnWidth = (right - left) / 2 - pad * 2;
  let leftY = y + 5;
  let rightY = y + 5;
  const leftLine = (text: string, style: "normal" | "bold" = "normal") => {
    setText(8.5, style);
    for (const line of doc.splitTextToSize(text, columnWidth)) {
      doc.text(line, left + pad, leftY);
      leftY += 4.2;
    }
  };
  const rightLine = (text: string, style: "normal" | "bold" = "normal") => {
    setText(8.5, style);
    for (const line of doc.splitTextToSize(text, columnWidth)) {
      doc.text(line, right - pad, rightY, { align: "right" });
      rightY += 4.2;
    }
  };

  leftLine("Customer Details", "bold");
  leftLine(data.buyer.legalName || data.buyer.tradeName || "Retail Customer");
  if (data.buyer.gstin) leftLine(`GSTIN : ${data.buyer.gstin}`, "bold");
  if (data.buyer.address) leftLine(data.buyer.address);
  if (data.buyer.phone) leftLine(`Tel : ${data.buyer.phone}`);
  if (data.buyer.email) leftLine(`Email : ${data.buyer.email}`);
  leftLine(`Place of Supply : ${data.placeOfSupply}`);
  leftLine(`Order No : #${data.orderNumber}`);
  leftLine("Reverse Charge : No");
  if (data.ewayBillRequired) leftLine("e-Way Bill required", "bold");

  const sellerName = data.seller.legalName || data.seller.tradeName || "Seller";
  rightLine(sellerName, "bold");
  if (data.seller.tradeName && data.seller.tradeName !== sellerName) rightLine(data.seller.tradeName);
  if (data.seller.address) rightLine(data.seller.address);
  const cityLine = [data.seller.city, data.seller.state].filter(Boolean).join(", ");
  if (cityLine || data.seller.pincode) rightLine([cityLine, data.seller.pincode].filter(Boolean).join(" - "));
  if (data.seller.phone) rightLine(`Tel : ${data.seller.phone}`);
  if (data.seller.email) rightLine(`Email : ${data.seller.email}`);
  rightLine(`GSTIN : ${data.seller.gstin || "N/A"}`);
  if (data.seller.pan) rightLine(`PAN : ${data.seller.pan}`);
  rightLine(`State Code : ${data.seller.stateCode}`);

  y = Math.max(leftY, rightY) + 1;

  // Line items: tax amount with its rate below it
  const taxCell = (amount: number, rate: number) => `${inr(amount)}\n(${rate}%)`;
  const halfRate = (item: InvoicePDFData["lineItems"][number]) => (data.isInterState ? 0 : item.gstRate / 2);
  const igstRate = (item: InvoicePDFData["lineItems"][number]) => (data.isInterState ? item.gstRate : 0);

  runAutoTable(doc, {
    startY: y,
    theme: "grid",
    margin: { left, right: pageWidth - right, top: 10, bottom: 12 },
    tableWidth: right - left,
    head: [["ITEM(s) DESCRIPTION", "HSN", "Qty", "RATE (Rs.)", "TAXABLE (Rs.)", "CGST", "SGST", "IGST", "AMOUNT (Rs.)"]],
    body: data.lineItems.map((item) => [
      item.sku ? `${item.title}\nSKU: ${item.sku}` : item.title,
      item.hsnCode,
      item.quantity,
      inr(item.unitPrice),
      item.discount > 0 ? `${inr(item.taxableValue)}\n(Disc: ${inr(item.discount)})` : inr(item.taxableValue),
      taxCell(item.cgstAmount, halfRate(item)),
      taxCell(item.sgstAmount, halfRate(item)),
      taxCell(item.igstAmount, igstRate(item)),
      inr(item.totalAmount),
    ]),
    foot: [["Total", "", "", "", { content: inr(data.subtotalTaxable), styles: { halign: "right" } }, { content: inr(data.cgstTotal), styles: { halign: "right" } }, { content: inr(data.sgstTotal), styles: { halign: "right" } }, { content: inr(data.igstTotal), styles: { halign: "right" } }, { content: inr(data.lineItems.reduce((sum, item) => sum + item.totalAmount, 0)), styles: { halign: "right" } }]],
    showFoot: "lastPage",
    styles: { fontSize: 7.5, cellPadding: 1.8, textColor: [50, 50, 50], lineColor: [190, 190, 190], lineWidth: 0.2, valign: "top" },
    headStyles: { fillColor: barColor, textColor: [30, 30, 30], fontStyle: "bold", fontSize: 7 },
    footStyles: { fillColor: [250, 249, 246], textColor: [30, 30, 30], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 48 },
      1: { cellWidth: 14 },
      2: { cellWidth: 9, halign: "center" },
      3: { cellWidth: 20, halign: "right" },
      4: { cellWidth: 21, halign: "right" },
      5: { cellWidth: 17, halign: "right" },
      6: { cellWidth: 17, halign: "right" },
      7: { cellWidth: 17, halign: "right" },
      8: { cellWidth: 19, halign: "right" },
    },
  });
  y = doc.lastAutoTable.finalY;

  // Amount lines add up to the invoice total, with item amounts shown before discount.
  const items = data.lineItems.filter((item) => item.hsnCode !== SHIPPING_SAC);
  const discountWithTax = items.reduce((sum, item) => sum + item.discount * (1 + item.gstRate / 100), 0);
  const itemsAmount = items.reduce((sum, item) => sum + item.totalAmount, 0);
  const shipping = data.lineItems.filter((item) => item.hsnCode === SHIPPING_SAC).reduce((sum, item) => sum + item.totalAmount, 0);
  const summary: Array<[string, string]> = [["Items Subtotal", `Rs. ${inr(itemsAmount + discountWithTax)}`]];
  if (discountWithTax >= 0.01) summary.push(["Discount", `-Rs. ${inr(discountWithTax)}`]);
  if (shipping > 0) summary.push(["Shipping", `Rs. ${inr(shipping)}`]);
  if (data.roundOff !== 0) summary.push(["Round-off", `Rs. ${inr(data.roundOff)}`]);

  const wordsLines = doc.splitTextToSize(numberToIndianWords(data.grandTotal), columnWidth);
  const hasBank = Boolean(data.bankDetails?.accountNo);
  const hasUpi = Boolean(data.bankDetails?.upiId);
  ensureSpace(Math.max(summary.length * 6 + 14, 24 + wordsLines.length * 4 + (hasBank ? 16 : 0) + (hasUpi ? 26 : 0)));

  let wordsY = y + 5;
  setText(8.5);
  doc.text("Total In Words", left + pad, wordsY);
  wordsY += 4.2;
  setText(8.5, "bold", 30);
  doc.text(wordsLines, left + pad, wordsY);
  wordsY += wordsLines.length * 4 + 2;
  setText(8.5);
  if (data.paymentMode) {
    doc.text(`Payment Mode : ${data.paymentMode}`.substring(0, 60), left + pad, wordsY);
    wordsY += 4.5;
  }
  if (hasBank) {
    doc.text(`Bank : ${data.bankDetails?.bankName || "N/A"}`, left + pad, wordsY);
    doc.text(`A/C No : ${data.bankDetails?.accountNo}`, left + pad, wordsY + 4);
    doc.text(`IFSC : ${data.bankDetails?.ifsc || "N/A"}`, left + pad, wordsY + 8);
    wordsY += 13;
  }
  if (hasUpi) {
    try {
      const qr = await QRCode.toDataURL(`upi://pay?pa=${data.bankDetails?.upiId}&pn=${encodeURIComponent(sellerName)}&am=${data.grandTotal}&cu=INR`, { width: 100, margin: 1 });
      doc.addImage(qr, "PNG", left + pad, wordsY, 20, 20);
      setText(7, "normal", 100);
      doc.text("Scan to pay by UPI", left + pad + 22, wordsY + 10);
      wordsY += 22;
    } catch (e) {
      // Ignore QR errors
    }
  }

  const summaryX = pageWidth / 2 + 8;
  let summaryY = y + 5;
  for (const [label, value] of summary) {
    setText(8.5);
    doc.text(label, summaryX, summaryY);
    doc.text(value, right - pad, summaryY, { align: "right" });
    doc.setDrawColor(215, 215, 215);
    doc.setLineWidth(0.2);
    doc.line(summaryX, summaryY + 2, right - pad, summaryY + 2);
    summaryY += 6;
  }
  setText(10.5, "bold", 30);
  doc.text("Total", summaryX, summaryY + 1);
  doc.text(`Rs. ${inr(data.grandTotal)}`, right - pad, summaryY + 1, { align: "right" });
  summaryY += 5;

  y = Math.max(wordsY, summaryY) + 1;
  rule(y);

  // Terms
  if (data.terms) {
    setText(7);
    const lines = doc.splitTextToSize(data.terms, right - left - pad * 2);
    ensureSpace(lines.length * 3.2 + 6);
    setText(7, "normal", 90);
    doc.text(lines, left + pad, y + 4.5);
    y += lines.length * 3.2 + 4;
    rule(y);
  }

  // Customer acceptance and seller signature
  ensureSpace(40);
  if (data.terms) {
    setText(8.5);
    doc.text("I have read, understood and agreed to the terms & conditions.", left + pad, y + 6);
    doc.text(`Customer Signature : ${(data.buyer.legalName || "").substring(0, 40)}`, left + pad, y + 12);
  }
  setText(8.5);
  doc.text(`For ${sellerName}`, right - pad, y + 6, { align: "right" });
  drawImage(doc, data.signatureDataUrl, right - pad, y + 8, 40, 20, "right");
  doc.text(data.customization?.signatureLabel || "Authorized Signatory", right - pad, y + 33, { align: "right" });
  y += 36;
  rule(y);

  // Footer
  ensureSpace(14);
  setText(7.5, "normal", 100);
  if (data.customization?.footerNote) {
    doc.text(data.customization.footerNote, pageWidth / 2, y + 4.5, { align: "center" });
    y += 4;
  }
  doc.text("This is a Computer Generated Invoice.", pageWidth / 2, y + 4.5, { align: "center" });
  y += 7;

  // Side borders on every page, ending where the content ends
  const pages = doc.getNumberOfPages();
  doc.setDrawColor(30, 30, 30);
  doc.setLineWidth(0.3);
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    const top = page === 1 ? boxTop : 10;
    const bottom = page === pages ? y : pageHeight - 10;
    doc.rect(left, top, right - left, bottom - top, "S");
  }

  return Buffer.from(doc.output("arraybuffer"));
}

/** Prints terms and the footer note, moving to a new page if they do not fit. */
function drawTermsAndFooter(doc: any, data: InvoicePDFData, startY: number, left: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = startY;

  if (data.terms) {
    const lines = doc.splitTextToSize(data.terms, pageWidth - left * 2);
    if (y + 5 + lines.length * 3.5 > pageHeight - 12) {
      doc.addPage();
      y = 16;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(60, 60, 60);
    doc.text("Terms & Conditions", left, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(lines, left, y + 4);
    y += 5 + lines.length * 3.5;
  }

  if (data.customization?.footerNote) {
    if (y + 6 > pageHeight - 8) {
      doc.addPage();
      y = 16;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(data.customization.footerNote, pageWidth / 2, y + 4, { align: "center" });
  }
}

const contactLine = (party: { phone?: string; email?: string }) =>
  [party.phone, party.email].filter(Boolean).join(" | ");

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
    phone?: string;
    email?: string;
    state: string;
    stateCode: string;
  };
  placeOfSupply: string;
  isInterState: boolean;
  lineItems: Array<{
    title: string;
    sku?: string;
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
  logoDataUrl?: string;
  signatureDataUrl?: string;
  paymentMode?: string;
  brandColor?: string;
  taxScheme?: string;
  ewayBillRequired?: boolean;
  customization?: {
    invoiceTitle?: string;
    invoiceSubtitle?: string;
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
  if (data.buyer.phone) {
    y += 3.5;
    doc.text(`Phone : ${data.buyer.phone}`, 4, y);
  }
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
  doc.text(doc.splitTextToSize(data.customization?.footerNote || "Thank You for Shopping With Us!", 72), 40, finalY, { align: "center" });

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

  if (data.logoDataUrl) {
    drawLogo(doc, data, 16, 8, 40, 12);
    y = 28;
  }

  // Minimal Header: Brand Name (Left), Invoice Tag (Right)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(20, 20, 20);
  doc.text(data.seller.legalName || data.seller.tradeName || "STUDIO", 16, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  doc.setTextColor(80, 80, 80);
  doc.text(data.customization?.invoiceTitle || (isComposition ? "BILL OF SUPPLY" : "INVOICE"), pageWidth - 16, y, { align: "right" });
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
  y += 3.8;

  if (data.buyer.address) doc.text(data.buyer.address.substring(0, 60), col3, y);
  y += 3.8;

  doc.text(contactLine(data.seller), col1, y);
  doc.text(contactLine(data.buyer), col3, y);
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

  if (data.bankDetails?.upiId) {
    try {
      const qr = await QRCode.toDataURL(`upi://pay?pa=${data.bankDetails.upiId}&am=${data.grandTotal}&cu=INR`, { width: 80, margin: 1 });
      doc.addImage(qr, "PNG", pageWidth - 34, finalY + 2, 18, 18);
      finalY += 20;
    } catch (e) {
      // Ignore QR errors
    }
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  doc.text(`For ${data.seller.legalName || data.seller.tradeName}`, pageWidth - 16, finalY + 8, { align: "right" });
  drawImage(doc, data.signatureDataUrl, pageWidth - 16, finalY + 10, 36, 12, "right");
  doc.text(data.customization?.signatureLabel || "Authorized Signatory", pageWidth - 16, finalY + 26, { align: "right" });

  drawTermsAndFooter(doc, data, finalY + 34, 16);

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

  if (template !== "modern_d2c") {
    return generateStandardPDF(data);
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

  // Modern D2C Header Banner with brand color
  doc.setFillColor(brandRgb[0], brandRgb[1], brandRgb[2]);
  doc.rect(0, 0, pageWidth, 28, "F");
  drawLogo(doc, data, pageWidth - 14, 7, 40, 14, true);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text(docTitle, 14, 15);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(230, 230, 230);
  doc.text(docSubtitle, 14, 21);

  y = 35;

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
  if (data.seller.pan) {
    sellerY += 4;
    doc.text(`PAN: ${data.seller.pan}`, leftX, sellerY);
  }
  if (data.seller.phone || data.seller.email) {
    sellerY += 4;
    doc.text(contactLine(data.seller).substring(0, 60), leftX, sellerY);
  }

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
  doc.text((data.buyer.address || "As per order shipping address").substring(0, 56), leftX + 3, y + 14);
  doc.text(contactLine(data.buyer).substring(0, 56), leftX + 3, y + 18);

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
  drawImage(doc, data.signatureDataUrl, pageWidth - 14, finalY + 2, 36, 12, "right");
  doc.text(`(${data.customization?.signatureLabel || "Authorized Signatory"})`, pageWidth - 14, finalY + 16, { align: "right" });

  drawTermsAndFooter(doc, data, finalY + 30, 14);

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
