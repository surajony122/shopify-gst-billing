/**
 * Indian Goods and Services Tax (GST) Calculation & Compliance Engine
 * Governed by the CGST Act, 2017 & Section 170 (Rounding Rules)
 */

export interface StateInfo {
  code: string;
  name: string;
}

export const GST_STATE_CODES: Record<string, StateInfo> = {
  "01": { code: "01", name: "Jammu and Kashmir" },
  "02": { code: "02", name: "Himachal Pradesh" },
  "03": { code: "03", name: "Punjab" },
  "04": { code: "04", name: "Chandigarh" },
  "05": { code: "05", name: "Uttarakhand" },
  "06": { code: "06", name: "Haryana" },
  "07": { code: "07", name: "Delhi" },
  "08": { code: "08", name: "Rajasthan" },
  "09": { code: "09", name: "Uttar Pradesh" },
  "10": { code: "10", name: "Bihar" },
  "11": { code: "11", name: "Sikkim" },
  "12": { code: "12", name: "Arunachal Pradesh" },
  "13": { code: "13", name: "Nagaland" },
  "14": { code: "14", name: "Manipur" },
  "15": { code: "15", name: "Mizoram" },
  "16": { code: "16", name: "Tripura" },
  "17": { code: "17", name: "Meghalaya" },
  "18": { code: "18", name: "Assam" },
  "19": { code: "19", name: "West Bengal" },
  "20": { code: "20", name: "Jharkhand" },
  "21": { code: "21", name: "Odisha" },
  "22": { code: "22", name: "Chhattisgarh" },
  "23": { code: "23", name: "Madhya Pradesh" },
  "24": { code: "24", name: "Gujarat" },
  "26": { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  "27": { code: "27", name: "Maharashtra" },
  "29": { code: "29", name: "Karnataka" },
  "30": { code: "30", name: "Goa" },
  "31": { code: "31", name: "Lakshadweep" },
  "32": { code: "32", name: "Kerala" },
  "33": { code: "33", name: "Tamil Nadu" },
  "34": { code: "34", name: "Puducherry" },
  "35": { code: "35", name: "Andaman and Nicobar Islands" },
  "36": { code: "36", name: "Telangana" },
  "37": { code: "37", name: "Andhra Pradesh" },
  "38": { code: "38", name: "Ladakh" },
  "97": { code: "97", name: "Other Territory" },
};

/**
 * Validate a 15-character GSTIN format
 */
export function validateGSTINFormat(gstin: string): boolean {
  if (!gstin) return false;
  const cleanGstin = gstin.trim().toUpperCase();
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!gstinRegex.test(cleanGstin)) return false;

  const stateCode = cleanGstin.substring(0, 2);
  return Boolean(GST_STATE_CODES[stateCode]);
}

/**
 * Extract 2-digit State Code from GSTIN
 */
export function getStateCodeFromGSTIN(gstin: string): string | null {
  if (!validateGSTINFormat(gstin)) return null;
  return gstin.trim().toUpperCase().substring(0, 2);
}

/**
 * Find State Code from State Name (case-insensitive fuzzy match)
 */
export function getStateCodeFromName(stateName: string): string {
  const normalized = stateName.toLowerCase().replace(/[^a-z]/g, "");
  for (const [code, info] of Object.entries(GST_STATE_CODES)) {
    const cleanInfo = info.name.toLowerCase().replace(/[^a-z]/g, "");
    if (cleanInfo === normalized || cleanInfo.includes(normalized) || normalized.includes(cleanInfo)) {
      return code;
    }
  }
  return "27"; // Default fallback (e.g. Maharashtra)
}

/**
 * Get current Indian Financial Year (e.g. "2026-27")
 * Indian FY runs from April 1st to March 31st.
 */
export function getCurrentFinancialYear(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  if (month >= 4) {
    const nextYearShort = String((year + 1) % 100).padStart(2, "0");
    return `${year}-${nextYearShort}`;
  } else {
    const yearShort = String(year % 100).padStart(2, "0");
    return `${year - 1}-${yearShort}`;
  }
}

/**
 * Format sequential invoice number based on prefix template
 * Example: "INV/{FY}/0001"
 */
export function formatInvoiceNumber(prefix: string, sequence: number, date: Date = new Date()): string {
  const fy = getCurrentFinancialYear(date);
  const seqStr = String(sequence).padStart(4, "0");
  return prefix.replace("{FY}", fy).replace("{SEQ}", seqStr) + (prefix.includes("{SEQ}") ? "" : seqStr);
}

export interface LineItemTaxInput {
  title: string;
  variantTitle?: string;
  sku?: string;
  hsnCode?: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  gstRate: number; // e.g. 18.0 for 18%
}

export interface LineItemTaxOutput {
  title: string;
  variantTitle?: string;
  sku?: string;
  hsnCode: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxableValue: number;
  gstRate: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  totalAmount: number;
}

export interface TaxCalculationResult {
  isInterState: boolean;
  sellerStateCode: string;
  buyerStateCode: string;
  placeOfSupplyState: string;
  lineItems: LineItemTaxOutput[];
  subtotalTaxable: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  cessTotal: number;
  unroundedGrandTotal: number;
  roundOffAmount: number;
  grandTotal: number;
}

/**
 * Calculate GST according to Indian Statutory Rules
 */
export function calculateOrderGST(params: {
  sellerStateCode: string;
  buyerStateCode: string;
  lineItems: LineItemTaxInput[];
  roundOff?: boolean;
}): TaxCalculationResult {
  const { sellerStateCode, buyerStateCode, lineItems, roundOff = true } = params;

  // Rule: If Seller State != Buyer State -> Interstate (IGST)
  // Rule: If Seller State == Buyer State -> Intrastate (CGST + SGST)
  const isInterState = sellerStateCode !== buyerStateCode;
  const buyerState = GST_STATE_CODES[buyerStateCode]?.name || "Unknown State";

  let subtotalTaxable = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  const processedItems: LineItemTaxOutput[] = lineItems.map((item) => {
    const qty = Math.max(1, item.quantity);
    const grossPrice = item.unitPrice * qty;
    const discount = item.discountAmount || 0;
    const taxableValue = Math.max(0, grossPrice - discount);

    let cgstRate = 0;
    let cgstAmount = 0;
    let sgstRate = 0;
    let sgstAmount = 0;
    let igstRate = 0;
    let igstAmount = 0;

    if (isInterState) {
      igstRate = item.gstRate;
      igstAmount = Number(((taxableValue * igstRate) / 100).toFixed(2));
    } else {
      cgstRate = item.gstRate / 2;
      sgstRate = item.gstRate / 2;
      cgstAmount = Number(((taxableValue * cgstRate) / 100).toFixed(2));
      sgstAmount = Number(((taxableValue * sgstRate) / 100).toFixed(2));
    }

    const itemTotal = Number((taxableValue + cgstAmount + sgstAmount + igstAmount).toFixed(2));

    subtotalTaxable += taxableValue;
    cgstTotal += cgstAmount;
    sgstTotal += sgstAmount;
    igstTotal += igstAmount;

    return {
      title: item.title,
      variantTitle: item.variantTitle,
      sku: item.sku,
      hsnCode: item.hsnCode || "999999",
      quantity: qty,
      unitPrice: item.unitPrice,
      discountAmount: discount,
      taxableValue: Number(taxableValue.toFixed(2)),
      gstRate: item.gstRate,
      cgstRate,
      cgstAmount,
      sgstRate,
      sgstAmount,
      igstRate,
      igstAmount,
      totalAmount: itemTotal,
    };
  });

  subtotalTaxable = Number(subtotalTaxable.toFixed(2));
  cgstTotal = Number(cgstTotal.toFixed(2));
  sgstTotal = Number(sgstTotal.toFixed(2));
  igstTotal = Number(igstTotal.toFixed(2));

  const unroundedGrandTotal = Number((subtotalTaxable + cgstTotal + sgstTotal + igstTotal).toFixed(2));

  // Section 170 Rounding: Round to nearest Rupee
  let grandTotal = unroundedGrandTotal;
  let roundOffAmount = 0;

  if (roundOff) {
    grandTotal = Math.round(unroundedGrandTotal);
    roundOffAmount = Number((grandTotal - unroundedGrandTotal).toFixed(2));
  }

  return {
    isInterState,
    sellerStateCode,
    buyerStateCode,
    placeOfSupplyState: `${buyerStateCode}-${buyerState}`,
    lineItems: processedItems,
    subtotalTaxable,
    cgstTotal,
    sgstTotal,
    igstTotal,
    cessTotal: 0,
    unroundedGrandTotal,
    roundOffAmount,
    grandTotal,
  };
}

export interface InvoiceRuleSettings {
  invoicePrefix: string;
  nextInvoiceNumber: number;
  b2bInvoicePrefix?: string | null;
  nextB2BInvoiceNumber?: number;
  b2bForceTemplate?: boolean;
  b2bForcedTemplate?: string;
  defaultTemplate?: string;
  
  amountRulesEnabled?: boolean;
  highValueThreshold?: number;
  highValueTemplate?: string;
  lowValueThreshold?: number;
  lowValueTemplate?: string;
  ewayBillNoticeThreshold?: number;

  apparelFootwearTierRule?: boolean;
  shippingTaxMode?: string;
  hsnLengthRequired?: number;
  roundOffSection170?: boolean;
}

export interface RuleEvaluationResult {
  selectedTemplate: string;
  invoicePrefix: string;
  isB2B: boolean;
  ewayBillRequired: boolean;
  panMandatoryNotice: boolean;
  appliedRuleNotes: string[];
}

/**
 * Evaluates Indian GST Invoicing Rules based on order parameters
 */
export function evaluateInvoiceRules(
  order: {
    totalAmount: number;
    buyerGstin?: string | null;
    lineItems?: Array<{ hsnCode?: string; unitPrice: number }>;
  },
  settings: InvoiceRuleSettings
): RuleEvaluationResult {
  const isB2B = Boolean(order.buyerGstin && validateGSTINFormat(order.buyerGstin));
  const appliedRuleNotes: string[] = [];

  // 1. Template Selection Routing
  let selectedTemplate = settings.defaultTemplate || "standard_b2b";

  if (isB2B && (settings.b2bForceTemplate ?? true)) {
    selectedTemplate = settings.b2bForcedTemplate || "standard_b2b";
    appliedRuleNotes.push(`B2B Rule: Assigned ${selectedTemplate} for registered GSTIN ${order.buyerGstin}`);
  } else if (settings.amountRulesEnabled) {
    if (order.totalAmount >= (settings.highValueThreshold ?? 10000)) {
      selectedTemplate = settings.highValueTemplate || "standard_b2b";
      appliedRuleNotes.push(`Amount Rule: Order total ₹${order.totalAmount.toFixed(2)} ≥ ₹${settings.highValueThreshold} -> Assigned ${selectedTemplate}`);
    } else if (order.totalAmount <= (settings.lowValueThreshold ?? 1000)) {
      selectedTemplate = settings.lowValueTemplate || "modern_d2c";
      appliedRuleNotes.push(`Amount Rule: Order total ₹${order.totalAmount.toFixed(2)} ≤ ₹${settings.lowValueThreshold} -> Assigned ${selectedTemplate}`);
    } else {
      appliedRuleNotes.push(`Default Rule: Order in standard range -> Assigned ${selectedTemplate}`);
    }
  } else {
    appliedRuleNotes.push(`Global Rule: Using default store template (${selectedTemplate})`);
  }

  // 2. Invoice Prefix Routing (B2B series vs Retail series)
  let invoicePrefix = settings.invoicePrefix || "INV/{FY}/";
  if (isB2B && settings.b2bInvoicePrefix && settings.b2bInvoicePrefix.trim() !== "") {
    invoicePrefix = settings.b2bInvoicePrefix;
    appliedRuleNotes.push(`Series Rule: B2B Order mapped to sequence ${invoicePrefix}`);
  } else {
    appliedRuleNotes.push(`Series Rule: Standard sequence ${invoicePrefix}`);
  }

  // 3. Statutory Compliance Checks
  const ewayBillNoticeThreshold = settings.ewayBillNoticeThreshold ?? 50000;
  const ewayBillRequired = order.totalAmount >= ewayBillNoticeThreshold;
  if (ewayBillRequired) {
    appliedRuleNotes.push(`Rule 138 CGST: Consignment value ₹${order.totalAmount.toFixed(2)} exceeds ₹${ewayBillNoticeThreshold} (e-Way Bill applicable)`);
  }

  const panMandatoryNotice = order.totalAmount >= 200000;
  if (panMandatoryNotice) {
    appliedRuleNotes.push(`Income Tax Rule 114B: High-value transaction > ₹2 Lakh requires customer PAN`);
  }

  return {
    selectedTemplate,
    invoicePrefix,
    isB2B,
    ewayBillRequired,
    panMandatoryNotice,
    appliedRuleNotes,
  };
}

/**
 * Resolves GST Rate for special HSN categories (e.g. Apparel & Footwear ₹1,000 price point threshold)
 */
export function resolveItemGstRate(
  hsnCode: string = "999999",
  unitPrice: number,
  fallbackRate: number = 18,
  tierRuleEnabled: boolean = true
): { rate: number; ruleApplied?: string } {
  const cleanHsn = hsnCode.trim();

  // Indian statutory rule: HSN chapters 61, 62 (Apparel/Garments) and 64 (Footwear)
  if (tierRuleEnabled && (cleanHsn.startsWith("61") || cleanHsn.startsWith("62") || cleanHsn.startsWith("64"))) {
    if (unitPrice <= 1000) {
      return {
        rate: 5.0,
        ruleApplied: `HSN ${cleanHsn} Tier: Unit price ≤ ₹1,000 applies 5% GST`,
      };
    } else {
      return {
        rate: 12.0,
        ruleApplied: `HSN ${cleanHsn} Tier: Unit price > ₹1,000 applies 12% GST`,
      };
    }
  }

  return { rate: fallbackRate };
}

/**
 * Composite Supply shipping GST rate under Section 8(a) of CGST Act
 */
export function resolveShippingGstRate(
  mode: string = "fixed_18",
  itemRates: number[] = [18]
): number {
  if (mode === "exempt_0") return 0;
  if (mode === "composite_highest") {
    if (itemRates.length === 0) return 18;
    return Math.max(...itemRates);
  }
  return 18; // Default fixed 18%
}
