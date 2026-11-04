import * as XLSX from "xlsx";
import { cleanStateName } from "./gst-engine";

// Inter-state B2C invoices above this are reported invoice-wise (Notification 12/2024-CT, from 1 Aug 2024).
const B2CL_THRESHOLD = 100000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface GSTR1LineItem {
  title: string;
  hsnCode: string;
  quantity: number;
  taxableValue: number;
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
}

export interface GSTR1Invoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  isB2B: boolean;
  buyerGstin: string | null;
  buyerTradeName: string | null;
  placeOfSupplyCode: string;
  placeOfSupplyState: string;
  isInterState: boolean;
  subtotalTaxable: number;
  grandTotal: number;
  lineItems: GSTR1LineItem[];
}

export interface GSTR1CreditNote {
  creditNoteNumber: string;
  date: Date;
  taxableAdjusted: number;
  grandTotalAdjusted: number;
  invoice: GSTR1Invoice;
}

interface TaxAmounts {
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
}

interface RateRow extends TaxAmounts {
  rate: number;
}

interface HsnRow extends TaxAmounts {
  hsn: string;
  desc: string;
  uqc: string;
  qty: number;
  rate: number;
}

const round2 = (value: number) => Number(value.toFixed(2));

/** Start (inclusive) and end (exclusive) of a return period in Indian time. */
export function getReturnPeriodRange(month: number, year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - IST_OFFSET_MS),
    end: new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS),
  };
}

/** dd-mm-yyyy in Indian time, the format the GST offline tool expects. */
export function formatGstDate(date: Date): string {
  const ist = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  const day = String(ist.getUTCDate()).padStart(2, "0");
  const month = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${ist.getUTCFullYear()}`;
}

function ratesFor(lines: GSTR1LineItem[], ratio = 1): RateRow[] {
  const byRate = new Map<number, RateRow>();
  for (const line of lines) {
    const row = byRate.get(line.gstRate) || { rate: line.gstRate, txval: 0, iamt: 0, camt: 0, samt: 0 };
    row.txval += line.taxableValue * ratio;
    row.iamt += line.igstAmount * ratio;
    row.camt += line.cgstAmount * ratio;
    row.samt += line.sgstAmount * ratio;
    byRate.set(line.gstRate, row);
  }
  return Array.from(byRate.values()).map((row) => ({
    rate: row.rate,
    txval: round2(row.txval),
    iamt: round2(row.iamt),
    camt: round2(row.camt),
    samt: round2(row.samt),
  }));
}

const isB2CLarge = (inv: GSTR1Invoice) => !inv.isB2B && inv.isInterState && inv.grandTotal > B2CL_THRESHOLD;
const isB2B = (inv: GSTR1Invoice) => inv.isB2B && Boolean(inv.buyerGstin);
const creditRatio = (cn: GSTR1CreditNote) =>
  cn.invoice.subtotalTaxable > 0 ? Math.min(1, cn.taxableAdjusted / cn.invoice.subtotalTaxable) : 0;
const posLabel = (inv: GSTR1Invoice) => `${inv.placeOfSupplyCode}-${cleanStateName(inv.placeOfSupplyState)}`;

function b2csSummary(invoices: GSTR1Invoice[], creditNotes: GSTR1CreditNote[]) {
  const rows = new Map<string, RateRow & { invoice: GSTR1Invoice }>();
  const add = (inv: GSTR1Invoice, ratio: number) => {
    for (const rate of ratesFor(inv.lineItems, ratio)) {
      const key = `${inv.placeOfSupplyCode}_${inv.isInterState}_${rate.rate}`;
      const row = rows.get(key) || { rate: rate.rate, txval: 0, iamt: 0, camt: 0, samt: 0, invoice: inv };
      row.txval += rate.txval;
      row.iamt += rate.iamt;
      row.camt += rate.camt;
      row.samt += rate.samt;
      rows.set(key, row);
    }
  };

  invoices.filter((inv) => !isB2B(inv) && !isB2CLarge(inv)).forEach((inv) => add(inv, 1));
  // Credit notes for small B2C invoices are netted off the summary rather than listed.
  creditNotes
    .filter((cn) => !isB2B(cn.invoice) && !isB2CLarge(cn.invoice))
    .forEach((cn) => add(cn.invoice, -creditRatio(cn)));

  // A ₹0 row, such as a fully discounted order, has nothing to report.
  return Array.from(rows.values()).filter((row) => round2(row.txval) !== 0);
}

function hsnSummary(invoices: GSTR1Invoice[], creditNotes: GSTR1CreditNote[], b2b: boolean): HsnRow[] {
  const rows = new Map<string, HsnRow>();
  const add = (line: GSTR1LineItem, ratio: number, qty: number) => {
    const key = `${line.hsnCode}_${line.gstRate}`;
    const isService = line.hsnCode.startsWith("99");
    const row = rows.get(key) || {
      hsn: line.hsnCode,
      desc: isService ? "Services" : "Goods",
      uqc: isService ? "NA" : "NOS",
      qty: 0,
      rate: line.gstRate,
      txval: 0,
      iamt: 0,
      camt: 0,
      samt: 0,
    };
    if (!isService) row.qty += qty;
    row.txval += line.taxableValue * ratio;
    row.iamt += line.igstAmount * ratio;
    row.camt += line.cgstAmount * ratio;
    row.samt += line.sgstAmount * ratio;
    rows.set(key, row);
  };

  invoices.filter((inv) => isB2B(inv) === b2b).forEach((inv) => inv.lineItems.forEach((l) => add(l, 1, l.quantity)));
  creditNotes
    .filter((cn) => isB2B(cn.invoice) === b2b)
    .forEach((cn) => cn.invoice.lineItems.forEach((l) => add(l, -creditRatio(cn), 0)));

  return Array.from(rows.values()).map((row) => ({
    ...row,
    txval: round2(row.txval),
    iamt: round2(row.iamt),
    camt: round2(row.camt),
    samt: round2(row.samt),
  }));
}

function documentSeries(numbers: string[], cancelled: string[] = []) {
  const series = new Map<string, string[]>();
  for (const number of [...numbers, ...cancelled]) {
    const prefix = number.replace(/\d+$/, "");
    series.set(prefix, [...(series.get(prefix) || []), number]);
  }
  return Array.from(series.values()).map((docs, index) => {
    const sorted = [...docs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const cancelCount = sorted.filter((number) => cancelled.includes(number)).length;
    return {
      num: index + 1,
      from: sorted[0],
      to: sorted[sorted.length - 1],
      totnum: sorted.length,
      cancel: cancelCount,
      net_issue: sorted.length - cancelCount,
    };
  });
}

const itemDetails = (rates: RateRow[]) =>
  rates.map((rate, index) => ({
    num: index + 1,
    itm_det: { rt: rate.rate, txval: rate.txval, iamt: rate.iamt, camt: rate.camt, samt: rate.samt, csamt: 0 },
  }));

const hsnJson = (rows: HsnRow[]) =>
  rows.map((row, index) => ({
    num: index + 1,
    hsn_sc: row.hsn,
    desc: row.desc,
    uqc: row.uqc,
    qty: row.qty,
    rt: row.rate,
    txval: row.txval,
    iamt: row.iamt,
    camt: row.camt,
    samt: row.samt,
    csamt: 0,
  }));

/** Builds the return file for the GST offline tool. */
export function buildGSTR1Json(
  invoices: GSTR1Invoice[],
  creditNotes: GSTR1CreditNote[],
  gstin: string,
  month: number,
  year: number,
  cancelledNumbers: string[] = []
) {
  const b2bByBuyer = new Map<string, GSTR1Invoice[]>();
  invoices.filter(isB2B).forEach((inv) => {
    const ctin = inv.buyerGstin as string;
    b2bByBuyer.set(ctin, [...(b2bByBuyer.get(ctin) || []), inv]);
  });

  const b2clByState = new Map<string, GSTR1Invoice[]>();
  invoices.filter(isB2CLarge).forEach((inv) => {
    b2clByState.set(inv.placeOfSupplyCode, [...(b2clByState.get(inv.placeOfSupplyCode) || []), inv]);
  });

  const cdnrByBuyer = new Map<string, GSTR1CreditNote[]>();
  creditNotes.filter((cn) => isB2B(cn.invoice)).forEach((cn) => {
    const ctin = cn.invoice.buyerGstin as string;
    cdnrByBuyer.set(ctin, [...(cdnrByBuyer.get(ctin) || []), cn]);
  });

  return {
    gstin,
    fp: `${String(month).padStart(2, "0")}${year}`,
    // These fields are last year's turnover, which the app does not hold. The tool accepts 0.
    gt: 0,
    cur_gt: 0,
    b2b: Array.from(b2bByBuyer.entries()).map(([ctin, list]) => ({
      ctin,
      inv: list.map((inv) => ({
        inum: inv.invoiceNumber,
        idt: formatGstDate(inv.invoiceDate),
        val: inv.grandTotal,
        pos: inv.placeOfSupplyCode,
        rchrg: "N",
        inv_typ: "R",
        itms: itemDetails(ratesFor(inv.lineItems)),
      })),
    })),
    b2cl: Array.from(b2clByState.entries()).map(([pos, list]) => ({
      pos,
      inv: list.map((inv) => ({
        inum: inv.invoiceNumber,
        idt: formatGstDate(inv.invoiceDate),
        val: inv.grandTotal,
        itms: itemDetails(ratesFor(inv.lineItems)),
      })),
    })),
    b2cs: b2csSummary(invoices, creditNotes).map((row) => ({
      sply_ty: row.invoice.isInterState ? "INTER" : "INTRA",
      rt: row.rate,
      typ: "OE",
      pos: row.invoice.placeOfSupplyCode,
      txval: round2(row.txval),
      iamt: round2(row.iamt),
      camt: round2(row.camt),
      samt: round2(row.samt),
      csamt: 0,
    })),
    cdnr: Array.from(cdnrByBuyer.entries()).map(([ctin, list]) => ({
      ctin,
      nt: list.map((cn) => ({
        ntty: "C",
        nt_num: cn.creditNoteNumber,
        nt_dt: formatGstDate(cn.date),
        val: cn.grandTotalAdjusted,
        pos: cn.invoice.placeOfSupplyCode,
        rchrg: "N",
        inv_typ: "R",
        itms: itemDetails(ratesFor(cn.invoice.lineItems, creditRatio(cn))),
      })),
    })),
    cdnur: creditNotes.filter((cn) => isB2CLarge(cn.invoice)).map((cn) => ({
      typ: "B2CL",
      ntty: "C",
      nt_num: cn.creditNoteNumber,
      nt_dt: formatGstDate(cn.date),
      val: cn.grandTotalAdjusted,
      pos: cn.invoice.placeOfSupplyCode,
      itms: itemDetails(ratesFor(cn.invoice.lineItems, creditRatio(cn))),
    })),
    hsn: {
      hsn_b2b: hsnJson(hsnSummary(invoices, creditNotes, true)),
      hsn_b2c: hsnJson(hsnSummary(invoices, creditNotes, false)),
    },
    doc_issue: {
      doc_det: [
        { doc_num: 1, doc_typ: "Invoices for outward supply", docs: documentSeries(invoices.map((i) => i.invoiceNumber), cancelledNumbers) },
        { doc_num: 5, doc_typ: "Credit Note", docs: documentSeries(creditNotes.map((c) => c.creditNoteNumber)) },
      ].filter((entry) => entry.docs.length > 0),
    },
  };
}

/** Passing the headers keeps the column titles on a sheet with no rows. */
const sheetWithHeaders = (rows: Record<string, unknown>[], headers: string[]) =>
  XLSX.utils.json_to_sheet(rows, { header: headers });

const HSN_HEADERS = ["HSN", "Description", "UQC", "Total Quantity", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"];
const B2B_HEADERS = ["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice Date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"];
const B2CL_HEADERS = ["Invoice Number", "Invoice Date", "Invoice Value", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"];
const B2CS_HEADERS = ["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"];
const CREDIT_HEADERS = ["GSTIN/UIN of Recipient", "Receiver Name", "Note Number", "Note Date", "Note Type", "Place Of Supply", "Note Value", "Rate", "Taxable Value", "Cess Amount"];
const DOC_HEADERS = ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"];

function hsnSheet(rows: HsnRow[]) {
  return sheetWithHeaders(
    rows.map((h) => ({
      "HSN": h.hsn,
      "Description": h.desc,
      "UQC": h.uqc,
      "Total Quantity": h.qty,
      "Rate": h.rate,
      "Taxable Value": h.txval,
      "Integrated Tax Amount": h.iamt,
      "Central Tax Amount": h.camt,
      "State/UT Tax Amount": h.samt,
      "Cess Amount": 0,
    })),
    HSN_HEADERS
  );
}

/**
 * Generate CA-Ready GSTR-1 Multi-Sheet Excel Workbook
 */
export function generateGSTR1Workbook(
  invoices: GSTR1Invoice[],
  creditNotes: GSTR1CreditNote[],
  cancelledNumbers: string[] = []
): Buffer {
  const wb = XLSX.utils.book_new();

  // 1. Sheet: B2B (one row per invoice and tax rate)
  const b2bRows = invoices.filter(isB2B).flatMap((inv) =>
    ratesFor(inv.lineItems).map((rate) => ({
      "GSTIN/UIN of Recipient": inv.buyerGstin,
      "Receiver Name": inv.buyerTradeName || "Business",
      "Invoice Number": inv.invoiceNumber,
      "Invoice Date": formatGstDate(inv.invoiceDate),
      "Invoice Value": inv.grandTotal,
      "Place Of Supply": posLabel(inv),
      "Reverse Charge": "N",
      "Applicable % of Tax Rate": "",
      "Invoice Type": "Regular",
      "E-Commerce GSTIN": "",
      "Rate": rate.rate,
      "Taxable Value": rate.txval,
      "Cess Amount": 0,
    }))
  );
  XLSX.utils.book_append_sheet(wb, sheetWithHeaders(b2bRows, B2B_HEADERS), "b2b");

  // 2. Sheet: B2CL (inter-state B2C invoices above the threshold)
  const b2clRows = invoices.filter(isB2CLarge).flatMap((inv) =>
    ratesFor(inv.lineItems).map((rate) => ({
      "Invoice Number": inv.invoiceNumber,
      "Invoice Date": formatGstDate(inv.invoiceDate),
      "Invoice Value": inv.grandTotal,
      "Place Of Supply": posLabel(inv),
      "Applicable % of Tax Rate": "",
      "Rate": rate.rate,
      "Taxable Value": rate.txval,
      "Cess Amount": 0,
      "E-Commerce GSTIN": "",
    }))
  );
  XLSX.utils.book_append_sheet(wb, sheetWithHeaders(b2clRows, B2CL_HEADERS), "b2cl");

  // 3. Sheet: B2CS (state-wise and rate-wise summary)
  const b2csRows = b2csSummary(invoices, creditNotes).map((row) => ({
    "Type": "OE", // Other than E-Commerce
    "Place Of Supply": posLabel(row.invoice),
    "Applicable % of Tax Rate": "",
    "Rate": row.rate,
    "Taxable Value": round2(row.txval),
    "Cess Amount": 0,
    "E-Commerce GSTIN": "",
  }));
  XLSX.utils.book_append_sheet(wb, sheetWithHeaders(b2csRows, B2CS_HEADERS), "b2cs");

  // 4. Sheets: Credit notes to registered and large unregistered buyers
  const creditRows = (list: GSTR1CreditNote[]) =>
    list.flatMap((cn) =>
      ratesFor(cn.invoice.lineItems, creditRatio(cn)).map((rate) => ({
        "GSTIN/UIN of Recipient": cn.invoice.buyerGstin || "",
        "Receiver Name": cn.invoice.buyerTradeName || "",
        "Note Number": cn.creditNoteNumber,
        "Note Date": formatGstDate(cn.date),
        "Note Type": "C",
        "Place Of Supply": posLabel(cn.invoice),
        "Note Value": cn.grandTotalAdjusted,
        "Rate": rate.rate,
        "Taxable Value": rate.txval,
        "Cess Amount": 0,
      }))
    );
  XLSX.utils.book_append_sheet(wb, sheetWithHeaders(creditRows(creditNotes.filter((cn) => isB2B(cn.invoice))), CREDIT_HEADERS), "cdnr");
  XLSX.utils.book_append_sheet(wb, sheetWithHeaders(creditRows(creditNotes.filter((cn) => isB2CLarge(cn.invoice))), CREDIT_HEADERS), "cdnur");

  // 5. Sheets: HSN Summary, split into B2B and B2C as Table 12 requires
  XLSX.utils.book_append_sheet(wb, hsnSheet(hsnSummary(invoices, creditNotes, true)), "hsn(b2b)");
  XLSX.utils.book_append_sheet(wb, hsnSheet(hsnSummary(invoices, creditNotes, false)), "hsn(b2c)");

  // 6. Sheet: Documents issued
  const docRows = [
    ...documentSeries(invoices.map((i) => i.invoiceNumber), cancelledNumbers).map((d) => ({ nature: "Invoices for outward supply", ...d })),
    ...documentSeries(creditNotes.map((c) => c.creditNoteNumber)).map((d) => ({ nature: "Credit Note", ...d })),
  ].map((d) => ({
    "Nature of Document": d.nature,
    "Sr. No. From": d.from,
    "Sr. No. To": d.to,
    "Total Number": d.totnum,
    "Cancelled": d.cancel,
  }));
  XLSX.utils.book_append_sheet(wb, sheetWithHeaders(docRows, DOC_HEADERS), "docs");

  // Return binary buffer
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
