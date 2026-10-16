import React from "react";
import { numberToIndianWords } from "../services/gst-engine";

export interface InvoicePreviewProps {
  invoice: {
    id: string;
    invoiceNumber: string;
    orderNumber: string;
    financialYear: string;
    date: string;
    orderDate?: string;
    isB2B: boolean;
    buyerGstin?: string | null;
    buyerTradeName?: string | null;
    shippingAddress?: any;
    billingAddress?: any;
    placeOfSupplyState: string;
    placeOfSupplyCode: string;
    isInterState: boolean;
    subtotalTaxable: number;
    cgstTotal: number;
    sgstTotal: number;
    igstTotal: number;
    roundOffAmount: number;
    grandTotal: number;
    ewayBillRequired?: boolean;
    lineItems: Array<{
      id?: string;
      title: string;
      variantTitle?: string | null;
      sku?: string | null;
      hsnCode: string;
      quantity: number;
      unitPrice: number;
      discountAmount?: number;
      taxableValue: number;
      gstRate: number;
      cgstAmount: number;
      sgstAmount: number;
      igstAmount: number;
      totalAmount: number;
    }>;
  };
  seller: {
    legalName?: string | null;
    tradeName?: string | null;
    gstin?: string | null;
    panNumber?: string | null;
    addressLine1?: string | null;
    city?: string | null;
    state?: string | null;
    stateCode?: string | null;
    pincode?: string | null;
    phone?: string | null;
    email?: string | null;
    bankName?: string | null;
    bankAccountNo?: string | null;
    bankIfsc?: string | null;
    upiId?: string | null;
    termsAndConditions?: string | null;
    brandColor?: string | null;
    taxScheme?: string | null;
    logoUrl?: string | null;
    // Editable Customizations
    invoiceTitle?: string | null;
    invoiceSubtitle?: string | null;
    showLogo?: boolean;
    showBankDetails?: boolean;
    showUpiQr?: boolean;
    showTerms?: boolean;
    showHsnSummary?: boolean;
    showSku?: boolean;
    showSignature?: boolean;
    signatureLabel?: string | null;
    signatureUrl?: string | null;
    footerNote?: string | null;
  };
  template?: string; // "standard_b2b" | "modern_d2c" | "minimalist" | "thermal_pos"
}

export function InvoiceHTMLPreview({ invoice, seller, template = "standard_b2b" }: InvoicePreviewProps) {
  const brandColor = seller.brandColor || "#212B36";
  const isComposition = seller.taxScheme === "composition";
  const sellerTitle = seller.tradeName || seller.legalName || "My Store";
  const buyerTitle = invoice.buyerTradeName || (invoice.isB2B ? "B2B Business Buyer" : "Retail Customer (B2C)");

  const words = numberToIndianWords(invoice.grandTotal);

  // Customization Fallbacks
  const displayTitle = seller.invoiceTitle || (isComposition ? "BILL OF SUPPLY" : "TAX INVOICE");
  const displaySubtitle = seller.invoiceSubtitle || (isComposition
    ? "Composition taxable person, not eligible to collect tax on supplies"
    : "Original for Recipient | Rule 46 CGST Act");
  const showLogo = seller.showLogo !== false && Boolean(seller.logoUrl);
  const showBank = seller.showBankDetails !== false && Boolean(seller.bankAccountNo || seller.bankName);
  const showUpi = seller.showUpiQr !== false && Boolean(seller.upiId);
  const showTerms = seller.showTerms !== false && Boolean(seller.termsAndConditions);
  const showHsnSummary = seller.showHsnSummary !== false;
  const showSku = Boolean(seller.showSku);
  const showSignature = seller.showSignature !== false;
  const signatureLabel = seller.signatureLabel || "Authorized Signatory";
  const footerNote = seller.footerNote || "Thank you for shopping with us!";

  // Compute HSN Summary Map
  const hsnSummaryMap = new Map<string, { hsn: string; taxable: number; cgst: number; sgst: number; igst: number; totalTax: number }>();
  invoice.lineItems.forEach((item) => {
    const existing = hsnSummaryMap.get(item.hsnCode) || { hsn: item.hsnCode, taxable: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 };
    existing.taxable += item.taxableValue;
    existing.cgst += item.cgstAmount;
    existing.sgst += item.sgstAmount;
    existing.igst += item.igstAmount;
    existing.totalTax += (item.cgstAmount + item.sgstAmount + item.igstAmount);
    hsnSummaryMap.set(item.hsnCode, existing);
  });
  const hsnSummaryList = Array.from(hsnSummaryMap.values());

  // 1. THERMAL POS TEMPLATE (80mm Receipt Roll)
  if (template === "thermal_pos") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "20px 0", background: "#f1f2f4" }}>
        <div
          id="invoice-printable-area"
          style={{
            width: "340px",
            background: "#ffffff",
            padding: "20px 16px",
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: "12px",
            color: "#111",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            lineHeight: "1.4",
          }}
        >
          {/* Store Header */}
          <div style={{ textAlign: "center", marginBottom: "8px" }}>
            {showLogo && (
              <div style={{ marginBottom: "6px" }}>
                <img src={seller.logoUrl!} alt="Logo" style={{ maxHeight: "36px", maxWidth: "120px", objectFit: "contain" }} />
              </div>
            )}
            <div style={{ fontWeight: "bold", fontSize: "15px", textTransform: "uppercase" }}>{sellerTitle}</div>
            {seller.addressLine1 && <div style={{ fontSize: "11px" }}>{seller.addressLine1}</div>}
            <div style={{ fontSize: "11px" }}>{seller.city}, {seller.state} - {seller.pincode}</div>
            <div style={{ fontSize: "11px", fontWeight: "bold" }}>GSTIN: {seller.gstin || "N/A"}</div>
            <div style={{ fontSize: "12px", fontWeight: "bold", marginTop: "4px" }}>
              *** {displayTitle} ***
            </div>
          </div>

          <div style={{ borderBottom: "1px dashed #666", margin: "8px 0" }} />

          {/* Metadata */}
          <div style={{ fontSize: "11px" }}>
            <div><strong>Inv No:</strong> {invoice.invoiceNumber}</div>
            <div><strong>Date  :</strong> {invoice.date} | <strong>Order:</strong> #{invoice.orderNumber}</div>
            <div><strong>Buyer :</strong> {buyerTitle.substring(0, 26)}</div>
            {invoice.buyerGstin && <div><strong>GSTIN :</strong> {invoice.buyerGstin}</div>}
            <div><strong>POS   :</strong> {invoice.placeOfSupplyCode}-{invoice.placeOfSupplyState}</div>
          </div>

          <div style={{ borderBottom: "1px dashed #666", margin: "8px 0" }} />

          {/* Items Table */}
          <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #333" }}>
                <th style={{ padding: "3px 0" }}>Item</th>
                <th style={{ textAlign: "center", padding: "3px 0" }}>Qty</th>
                <th style={{ textAlign: "right", padding: "3px 0" }}>Rate</th>
                <th style={{ textAlign: "right", padding: "3px 0" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: "1px dotted #ccc" }}>
                  <td style={{ padding: "4px 0", maxWidth: "150px", wordBreak: "break-word" }}>
                    {item.title}
                    {showSku && item.sku && <div style={{ fontSize: "9px", color: "#888" }}>SKU: {item.sku}</div>}
                    <div style={{ fontSize: "9px", color: "#666" }}>HSN: {item.hsnCode}</div>
                  </td>
                  <td style={{ textAlign: "center", padding: "4px 0" }}>{item.quantity}</td>
                  <td style={{ textAlign: "right", padding: "4px 0" }}>{item.unitPrice.toFixed(0)}</td>
                  <td style={{ textAlign: "right", padding: "4px 0" }}>{item.totalAmount.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ borderBottom: "1px dashed #666", margin: "8px 0" }} />

          {/* Totals */}
          <div style={{ fontSize: "11px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
              <span>Taxable Value:</span>
              <span>₹{invoice.subtotalTaxable.toFixed(2)}</span>
            </div>
            {invoice.isInterState ? (
              <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                <span>IGST:</span>
                <span>₹{invoice.igstTotal.toFixed(2)}</span>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                  <span>CGST:</span>
                  <span>₹{invoice.cgstTotal.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                  <span>SGST:</span>
                  <span>₹{invoice.sgstTotal.toFixed(2)}</span>
                </div>
              </>
            )}
            {invoice.roundOffAmount !== 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                <span>Round-off:</span>
                <span>₹{invoice.roundOffAmount.toFixed(2)}</span>
              </div>
            )}
          </div>

          <div style={{ borderBottom: "2px solid #000", margin: "8px 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", fontWeight: "bold" }}>
            <span>NET TOTAL:</span>
            <span>₹{invoice.grandTotal.toFixed(2)}</span>
          </div>

          <div style={{ textAlign: "center", marginTop: "16px", fontSize: "11px", color: "#444" }}>
            {showUpi && <div style={{ marginBottom: "4px" }}>UPI Pay: {seller.upiId}</div>}
            <div>{footerNote}</div>
          </div>
        </div>
      </div>
    );
  }

  // 2. MINIMALIST STUDIO TEMPLATE
  if (template === "minimalist") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "20px 0", background: "#f8f9fa" }}>
        <div
          id="invoice-printable-area"
          style={{
            width: "740px",
            background: "#ffffff",
            padding: "40px",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            fontSize: "13px",
            color: "#1f2937",
            boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
            lineHeight: "1.5",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
            <div>
              {showLogo && (
                <div style={{ marginBottom: "8px" }}>
                  <img src={seller.logoUrl!} alt="Logo" style={{ maxHeight: "42px", maxWidth: "160px", objectFit: "contain" }} />
                </div>
              )}
              <div style={{ fontSize: "20px", fontWeight: "700", color: "#111827", letterSpacing: "-0.5px" }}>{sellerTitle}</div>
              <div style={{ color: "#6b7280", fontSize: "12px", marginTop: "4px" }}>{seller.addressLine1}</div>
              <div style={{ color: "#6b7280", fontSize: "12px" }}>{seller.city}, {seller.state} - {seller.pincode}</div>
              <div style={{ color: "#111827", fontSize: "12px", fontWeight: "600", marginTop: "4px" }}>GSTIN: {seller.gstin || "N/A"}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "20px", fontWeight: "300", color: "#4b5563", letterSpacing: "1px" }}>
                {displayTitle}
              </div>
              <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>{displaySubtitle}</div>
              <div style={{ fontSize: "13px", fontWeight: "600", marginTop: "8px" }}>#{invoice.invoiceNumber}</div>
              <div style={{ fontSize: "12px", color: "#6b7280" }}>Date: {invoice.date}</div>
            </div>
          </div>

          <div style={{ borderBottom: "1px solid #e5e7eb", margin: "20px 0" }} />

          {/* Billed To / Details */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px", fontSize: "12px" }}>
            <div>
              <div style={{ textTransform: "uppercase", fontSize: "10px", fontWeight: "700", color: "#9ca3af", letterSpacing: "0.5px", marginBottom: "4px" }}>BILLED TO</div>
              <div style={{ fontWeight: "600", fontSize: "14px", color: "#111827" }}>{buyerTitle}</div>
              {invoice.buyerGstin && (
                <div style={{ fontWeight: "600", color: "#059669", marginTop: "2px" }}>GSTIN: {invoice.buyerGstin}</div>
              )}
              <div style={{ color: "#6b7280" }}>Place of Supply: {invoice.placeOfSupplyCode} - {invoice.placeOfSupplyState}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ textTransform: "uppercase", fontSize: "10px", fontWeight: "700", color: "#9ca3af", letterSpacing: "0.5px", marginBottom: "4px" }}>ORDER DETAILS</div>
              <div style={{ fontWeight: "600", color: "#111827" }}>Shopify Order #{invoice.orderNumber}</div>
              <div style={{ color: "#6b7280" }}>Tax Type: {invoice.isInterState ? "Inter-State (IGST)" : "Intra-State (CGST+SGST)"}</div>
            </div>
          </div>

          {/* Items Table */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", marginBottom: "20px" }}>
            <thead>
              <tr style={{ borderBottom: "1.5px solid #111827", textAlign: "left", color: "#111827" }}>
                <th style={{ padding: "8px 4px", fontWeight: "600" }}>Description</th>
                {showSku && <th style={{ padding: "8px 4px", textAlign: "center", fontWeight: "600" }}>SKU</th>}
                <th style={{ padding: "8px 4px", textAlign: "center", fontWeight: "600" }}>HSN</th>
                <th style={{ padding: "8px 4px", textAlign: "center", fontWeight: "600" }}>Qty</th>
                <th style={{ padding: "8px 4px", textAlign: "right", fontWeight: "600" }}>Rate</th>
                <th style={{ padding: "8px 4px", textAlign: "right", fontWeight: "600" }}>Taxable</th>
                <th style={{ padding: "8px 4px", textAlign: "right", fontWeight: "600" }}>GST</th>
                <th style={{ padding: "8px 4px", textAlign: "right", fontWeight: "600" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "10px 4px" }}>
                    <div style={{ fontWeight: "600" }}>{item.title}</div>
                    {item.variantTitle && <div style={{ fontSize: "11px", color: "#9ca3af" }}>{item.variantTitle}</div>}
                  </td>
                  {showSku && <td style={{ padding: "10px 4px", textAlign: "center", color: "#6b7280" }}>{item.sku || "-"}</td>}
                  <td style={{ padding: "10px 4px", textAlign: "center", color: "#6b7280" }}>{item.hsnCode}</td>
                  <td style={{ padding: "10px 4px", textAlign: "center" }}>{item.quantity}</td>
                  <td style={{ padding: "10px 4px", textAlign: "right" }}>₹{item.unitPrice.toFixed(2)}</td>
                  <td style={{ padding: "10px 4px", textAlign: "right" }}>₹{item.taxableValue.toFixed(2)}</td>
                  <td style={{ padding: "10px 4px", textAlign: "right", color: "#6b7280" }}>{item.gstRate}%</td>
                  <td style={{ padding: "10px 4px", textAlign: "right", fontWeight: "600" }}>₹{item.totalAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Subtotals & Totals */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div style={{ width: "260px", fontSize: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#4b5563" }}>
                <span>Taxable Subtotal:</span>
                <span>₹{invoice.subtotalTaxable.toFixed(2)}</span>
              </div>
              {invoice.isInterState ? (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#4b5563" }}>
                  <span>IGST Total:</span>
                  <span>₹{invoice.igstTotal.toFixed(2)}</span>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#4b5563" }}>
                    <span>CGST Total:</span>
                    <span>₹{invoice.cgstTotal.toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#4b5563" }}>
                    <span>SGST Total:</span>
                    <span>₹{invoice.sgstTotal.toFixed(2)}</span>
                  </div>
                </>
              )}
              {invoice.roundOffAmount !== 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#4b5563" }}>
                  <span>Round-off (Sec 170):</span>
                  <span>₹{invoice.roundOffAmount.toFixed(2)}</span>
                </div>
              )}
              <div style={{ borderBottom: "1.5px solid #111827", margin: "8px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "15px", fontWeight: "700", color: "#111827" }}>
                <span>Grand Total:</span>
                <span>₹{invoice.grandTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div style={{ borderBottom: "1px solid #e5e7eb", margin: "24px 0" }} />

          {/* Words, Bank & Signature */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: "11px", color: "#6b7280" }}>
            <div>
              <div><strong>Amount in words:</strong> {words}</div>
              {showBank && (
                <div style={{ marginTop: "6px" }}>
                  Bank: {seller.bankName} | A/C: {seller.bankAccountNo} | IFSC: {seller.bankIfsc} {showUpi && `| UPI: ${seller.upiId}`}
                </div>
              )}
              <div style={{ marginTop: "4px", fontStyle: "italic" }}>{footerNote}</div>
            </div>
            {showSignature && (
              <div style={{ textAlign: "right" }}>
                {seller.signatureUrl && (
                  <div style={{ marginBottom: "4px" }}>
                    <img src={seller.signatureUrl} alt="Signature" style={{ maxHeight: "40px", maxWidth: "120px", objectFit: "contain" }} />
                  </div>
                )}
                <div style={{ borderTop: "1px solid #9ca3af", paddingTop: "4px", minWidth: "140px", textAlign: "center" }}>
                  {signatureLabel}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 3. MODERN D2C TEMPLATE
  if (template === "modern_d2c") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "20px 0", background: "#f1f2f4" }}>
        <div
          id="invoice-printable-area"
          style={{
            width: "740px",
            background: "#ffffff",
            borderRadius: "12px",
            overflow: "hidden",
            boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            fontSize: "13px",
            color: "#1f2937",
          }}
        >
          {/* Branded Header Banner */}
          <div style={{ background: brandColor, color: "#fff", padding: "24px 32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                {showLogo && (
                  <div style={{ background: "#ffffff", padding: "6px 12px", borderRadius: "8px" }}>
                    <img src={seller.logoUrl!} alt="Logo" style={{ maxHeight: "36px", maxWidth: "120px", objectFit: "contain", display: "block" }} />
                  </div>
                )}
                <div>
                  <div style={{ fontSize: "22px", fontWeight: "800", letterSpacing: "0.5px" }}>
                    {displayTitle}
                  </div>
                  <div style={{ fontSize: "12px", opacity: 0.9, marginTop: "2px" }}>
                    {displaySubtitle}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "16px", fontWeight: "700" }}>{sellerTitle}</div>
                <div style={{ fontSize: "12px", opacity: 0.9 }}>GSTIN: {seller.gstin || "N/A"}</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", marginTop: "16px", flexWrap: "wrap" }}>
              <span style={{ background: "rgba(255,255,255,0.2)", padding: "4px 10px", borderRadius: "6px", fontSize: "12px" }}>
                Invoice: <strong>{invoice.invoiceNumber}</strong>
              </span>
              <span style={{ background: "rgba(255,255,255,0.2)", padding: "4px 10px", borderRadius: "6px", fontSize: "12px" }}>
                Date: <strong>{invoice.date}</strong>
              </span>
              <span style={{ background: "rgba(255,255,255,0.2)", padding: "4px 10px", borderRadius: "6px", fontSize: "12px" }}>
                Order: <strong>#{invoice.orderNumber}</strong>
              </span>
              {invoice.ewayBillRequired && (
                <span style={{ background: "#ef4444", color: "#fff", padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: "bold" }}>
                  e-Way Bill &gt; ₹50,000
                </span>
              )}
            </div>
          </div>

          <div style={{ padding: "28px 32px" }}>
            {/* Customer & Place of Supply Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>Customer Information</div>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a", marginTop: "4px" }}>{buyerTitle}</div>
                {invoice.buyerGstin ? (
                  <div style={{ fontSize: "12px", fontWeight: "600", color: "#059669", marginTop: "2px" }}>GSTIN: {invoice.buyerGstin}</div>
                ) : (
                  <div style={{ fontSize: "12px", color: "#64748b" }}>Retail Consumer (B2C)</div>
                )}
              </div>

              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>Place of Supply & Tax Mode</div>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#0f172a", marginTop: "4px" }}>
                  {invoice.placeOfSupplyCode} - {invoice.placeOfSupplyState}
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                  {invoice.isInterState ? "Inter-State Supply (IGST)" : "Intra-State Supply (CGST + SGST)"}
                </div>
              </div>
            </div>

            {/* Table */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", marginBottom: "20px" }}>
              <thead>
                <tr style={{ background: "#f1f5f9", color: "#334155" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left", borderRadius: "6px 0 0 6px" }}>Item Description</th>
                  {showSku && <th style={{ padding: "10px 8px", textAlign: "center" }}>SKU</th>}
                  <th style={{ padding: "10px 8px", textAlign: "center" }}>HSN</th>
                  <th style={{ padding: "10px 8px", textAlign: "center" }}>Qty</th>
                  <th style={{ padding: "10px 8px", textAlign: "right" }}>Rate</th>
                  <th style={{ padding: "10px 8px", textAlign: "right" }}>Taxable</th>
                  <th style={{ padding: "10px 8px", textAlign: "right" }}>GST</th>
                  <th style={{ padding: "10px 12px", textAlign: "right", borderRadius: "0 6px 6px 0" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems.map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0", background: idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ fontWeight: "600", color: "#0f172a" }}>{item.title}</div>
                      {item.variantTitle && <div style={{ fontSize: "11px", color: "#64748b" }}>{item.variantTitle}</div>}
                    </td>
                    {showSku && <td style={{ padding: "10px 8px", textAlign: "center", color: "#64748b" }}>{item.sku || "-"}</td>}
                    <td style={{ padding: "10px 8px", textAlign: "center", color: "#64748b" }}>{item.hsnCode}</td>
                    <td style={{ padding: "10px 8px", textAlign: "center", fontWeight: "600" }}>{item.quantity}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right" }}>₹{item.unitPrice.toFixed(2)}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right" }}>₹{item.taxableValue.toFixed(2)}</td>
                    <td style={{ padding: "10px 8px", textAlign: "right", color: "#475569" }}>
                      {item.gstRate}% (₹{(item.cgstAmount + item.sgstAmount + item.igstAmount).toFixed(2)})
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: "700", color: "#0f172a" }}>
                      ₹{item.totalAmount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Total Card */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "20px" }}>
              <div style={{ fontSize: "12px", color: "#64748b", maxWidth: "380px" }}>
                <div><strong>Amount in Words:</strong> {words}</div>
                {showBank && (
                  <div style={{ marginTop: "8px", padding: "8px 12px", background: "#f8fafc", borderRadius: "6px" }}>
                    Bank: <strong>{seller.bankName}</strong> | A/C: <strong>{seller.bankAccountNo}</strong> | IFSC: <strong>{seller.bankIfsc}</strong>
                    {showUpi && <div>UPI ID: <strong>{seller.upiId}</strong></div>}
                  </div>
                )}
                <div style={{ marginTop: "8px", fontStyle: "italic" }}>{footerNote}</div>
              </div>

              <div style={{ width: "240px", background: "#f8fafc", padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", margin: "3px 0", color: "#64748b" }}>
                  <span>Taxable Subtotal:</span>
                  <span>₹{invoice.subtotalTaxable.toFixed(2)}</span>
                </div>
                {invoice.isInterState ? (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", margin: "3px 0", color: "#64748b" }}>
                    <span>IGST:</span>
                    <span>₹{invoice.igstTotal.toFixed(2)}</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", margin: "3px 0", color: "#64748b" }}>
                      <span>CGST:</span>
                      <span>₹{invoice.cgstTotal.toFixed(2)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", margin: "3px 0", color: "#64748b" }}>
                      <span>SGST:</span>
                      <span>₹{invoice.sgstTotal.toFixed(2)}</span>
                    </div>
                  </>
                )}
                {invoice.roundOffAmount !== 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", margin: "3px 0", color: "#64748b" }}>
                    <span>Round-off (Sec 170):</span>
                    <span>₹{invoice.roundOffAmount.toFixed(2)}</span>
                  </div>
                )}
                <div style={{ borderTop: "2px solid #0f172a", margin: "8px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                  <span>Total Payable:</span>
                  <span>₹{invoice.grandTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Signature & Declaration */}
            {showSignature && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                <div style={{ textAlign: "center", minWidth: "160px" }}>
                  {seller.signatureUrl && (
                    <img src={seller.signatureUrl} alt="Signature" style={{ maxHeight: "40px", maxWidth: "120px", objectFit: "contain", marginBottom: "4px" }} />
                  )}
                  <div style={{ borderTop: "1px solid #cbd5e1", paddingTop: "4px", fontSize: "11px", fontWeight: "600", color: "#475569" }}>
                    {signatureLabel}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 4. STANDARD TRADITIONAL B2B TEMPLATE (Default Rule 46 Statutory)
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "20px 0", background: "#f1f2f4" }}>
      <div
        id="invoice-printable-area"
        style={{
          width: "780px",
          background: "#ffffff",
          padding: "24px",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          fontSize: "12px",
          color: "#0f172a",
          boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
          lineHeight: "1.4",
        }}
      >
        {/* Header with optional Logo */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1.5px solid #334155", paddingBottom: "10px", marginBottom: "12px" }}>
          {showLogo ? (
            <div style={{ maxWidth: "160px" }}>
              <img src={seller.logoUrl!} alt="Logo" style={{ maxHeight: "48px", maxWidth: "160px", objectFit: "contain" }} />
            </div>
          ) : <div />}
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: "18px", fontWeight: "800", letterSpacing: "1px", color: brandColor }}>
              {displayTitle}
            </div>
            <div style={{ fontSize: "11px", color: "#475569" }}>
              {displaySubtitle}
            </div>
          </div>
          <div style={{ width: showLogo ? "160px" : "0px", textAlign: "right" }} />
        </div>

        {/* 2-Column Seller / Invoice Metadata */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", border: "1px solid #cbd5e1", marginBottom: "12px" }}>
          <div style={{ padding: "10px", borderRight: "1px solid #cbd5e1" }}>
            <div style={{ fontSize: "14px", fontWeight: "800", color: brandColor }}>{sellerTitle}</div>
            <div style={{ color: "#334155" }}>{seller.addressLine1}</div>
            <div style={{ color: "#334155" }}>{seller.city}, {seller.state} - {seller.pincode}</div>
            <div style={{ fontWeight: "700", marginTop: "4px" }}>GSTIN: {seller.gstin || "N/A"}</div>
            {seller.panNumber && <div>PAN: {seller.panNumber}</div>}
            <div>State: {seller.state} (State Code: {seller.stateCode})</div>
          </div>
          <div style={{ padding: "10px", background: "#fafafa" }}>
            <div><strong>Invoice No:</strong> <span style={{ fontWeight: "700" }}>{invoice.invoiceNumber}</span></div>
            <div><strong>Invoice Date:</strong> {invoice.date}</div>
            <div><strong>Order No:</strong> #{invoice.orderNumber}</div>
            <div><strong>Place of Supply:</strong> {invoice.placeOfSupplyCode} - {invoice.placeOfSupplyState}</div>
            <div><strong>Reverse Charge:</strong> No</div>
            {invoice.ewayBillRequired && (
              <div style={{ color: "#dc2626", fontWeight: "700", marginTop: "4px" }}>
                ⚠ e-Way Bill Applicable (&gt; ₹50,000)
              </div>
            )}
          </div>
        </div>

        {/* Buyer Details Box */}
        <div style={{ border: "1px solid #cbd5e1", padding: "10px", background: "#f8fafc", marginBottom: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: "10px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>BILLED TO / RECIPIENT</div>
              <div style={{ fontSize: "13px", fontWeight: "800" }}>{buyerTitle}</div>
              {invoice.buyerGstin ? (
                <div style={{ fontWeight: "700", color: "#166534" }}>BUYER GSTIN: {invoice.buyerGstin}</div>
              ) : (
                <div style={{ color: "#64748b" }}>Type: Unregistered Consumer (B2C)</div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <div>State: {invoice.placeOfSupplyState}</div>
              <div>State Code: {invoice.placeOfSupplyCode}</div>
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", border: "1px solid #cbd5e1", marginBottom: "12px" }}>
          <thead>
            <tr style={{ background: brandColor, color: "#fff" }}>
              <th style={{ border: "1px solid #475569", padding: "6px 4px", textAlign: "center" }}>#</th>
              <th style={{ border: "1px solid #475569", padding: "6px 8px", textAlign: "left" }}>Item Description</th>
              {showSku && <th style={{ border: "1px solid #475569", padding: "6px 4px", textAlign: "center" }}>SKU</th>}
              <th style={{ border: "1px solid #475569", padding: "6px 4px", textAlign: "center" }}>HSN/SAC</th>
              <th style={{ border: "1px solid #475569", padding: "6px 4px", textAlign: "center" }}>Qty</th>
              <th style={{ border: "1px solid #475569", padding: "6px 6px", textAlign: "right" }}>Rate</th>
              <th style={{ border: "1px solid #475569", padding: "6px 6px", textAlign: "right" }}>Taxable</th>
              {invoice.isInterState ? (
                <>
                  <th style={{ border: "1px solid #475569", padding: "6px 4px", textAlign: "center" }}>IGST %</th>
                  <th style={{ border: "1px solid #475569", padding: "6px 6px", textAlign: "right" }}>IGST Amt</th>
                </>
              ) : (
                <>
                  <th style={{ border: "1px solid #475569", padding: "6px 6px", textAlign: "right" }}>CGST</th>
                  <th style={{ border: "1px solid #475569", padding: "6px 6px", textAlign: "right" }}>SGST</th>
                </>
              )}
              <th style={{ border: "1px solid #475569", padding: "6px 8px", textAlign: "right" }}>Total (INR)</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((item, idx) => (
              <tr key={idx} style={{ background: idx % 2 === 0 ? "#fff" : "#f8fafc" }}>
                <td style={{ border: "1px solid #cbd5e1", textAlign: "center", padding: "6px 4px" }}>{idx + 1}</td>
                <td style={{ border: "1px solid #cbd5e1", padding: "6px 8px" }}>
                  <div style={{ fontWeight: "600" }}>{item.title}</div>
                  {item.variantTitle && <div style={{ fontSize: "10px", color: "#64748b" }}>{item.variantTitle}</div>}
                </td>
                {showSku && <td style={{ border: "1px solid #cbd5e1", textAlign: "center", padding: "6px 4px", color: "#64748b" }}>{item.sku || "-"}</td>}
                <td style={{ border: "1px solid #cbd5e1", textAlign: "center", padding: "6px 4px" }}>{item.hsnCode}</td>
                <td style={{ border: "1px solid #cbd5e1", textAlign: "center", padding: "6px 4px", fontWeight: "600" }}>{item.quantity}</td>
                <td style={{ border: "1px solid #cbd5e1", textAlign: "right", padding: "6px 6px" }}>{item.unitPrice.toFixed(2)}</td>
                <td style={{ border: "1px solid #cbd5e1", textAlign: "right", padding: "6px 6px" }}>{item.taxableValue.toFixed(2)}</td>
                {invoice.isInterState ? (
                  <>
                    <td style={{ border: "1px solid #cbd5e1", textAlign: "center", padding: "6px 4px" }}>{item.gstRate}%</td>
                    <td style={{ border: "1px solid #cbd5e1", textAlign: "right", padding: "6px 6px" }}>{item.igstAmount.toFixed(2)}</td>
                  </>
                ) : (
                  <>
                    <td style={{ border: "1px solid #cbd5e1", textAlign: "right", padding: "6px 6px" }}>{item.cgstAmount.toFixed(2)}</td>
                    <td style={{ border: "1px solid #cbd5e1", textAlign: "right", padding: "6px 6px" }}>{item.sgstAmount.toFixed(2)}</td>
                  </>
                )}
                <td style={{ border: "1px solid #cbd5e1", textAlign: "right", padding: "6px 8px", fontWeight: "700" }}>{item.totalAmount.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* HSN Summary Statutory Breakdown Table */}
        {showHsnSummary && (
          <div style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "10px", fontWeight: "700", color: "#475569", textTransform: "uppercase", marginBottom: "4px" }}>
              HSN / SAC Wise Statutory Tax Summary
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px", border: "1px solid #cbd5e1" }}>
              <thead>
                <tr style={{ background: "#f8fafc", color: "#334155" }}>
                  <th style={{ border: "1px solid #cbd5e1", padding: "4px" }}>HSN/SAC</th>
                  <th style={{ border: "1px solid #cbd5e1", padding: "4px", textAlign: "right" }}>Taxable Amt</th>
                  {invoice.isInterState ? (
                    <th style={{ border: "1px solid #cbd5e1", padding: "4px", textAlign: "right" }}>IGST</th>
                  ) : (
                    <>
                      <th style={{ border: "1px solid #cbd5e1", padding: "4px", textAlign: "right" }}>CGST</th>
                      <th style={{ border: "1px solid #cbd5e1", padding: "4px", textAlign: "right" }}>SGST</th>
                    </>
                  )}
                  <th style={{ border: "1px solid #cbd5e1", padding: "4px", textAlign: "right" }}>Total Tax</th>
                </tr>
              </thead>
              <tbody>
                {hsnSummaryList.map((h, i) => (
                  <tr key={i}>
                    <td style={{ border: "1px solid #cbd5e1", padding: "4px", textAlign: "center" }}>{h.hsn}</td>
                    <td style={{ border: "1px solid #cbd5e1", padding: "4px", textAlign: "right" }}>₹{h.taxable.toFixed(2)}</td>
                    {invoice.isInterState ? (
                      <td style={{ border: "1px solid #cbd5e1", padding: "4px", textAlign: "right" }}>₹{h.igst.toFixed(2)}</td>
                    ) : (
                      <>
                        <td style={{ border: "1px solid #cbd5e1", padding: "4px", textAlign: "right" }}>₹{h.cgst.toFixed(2)}</td>
                        <td style={{ border: "1px solid #cbd5e1", padding: "4px", textAlign: "right" }}>₹{h.sgst.toFixed(2)}</td>
                      </>
                    )}
                    <td style={{ border: "1px solid #cbd5e1", padding: "4px", textAlign: "right", fontWeight: "600" }}>₹{h.totalTax.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Summary Block */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", border: "1px solid #cbd5e1", marginBottom: "12px" }}>
          <div style={{ padding: "10px", borderRight: "1px solid #cbd5e1" }}>
            <div><strong>Amount in words:</strong></div>
            <div style={{ fontStyle: "italic", marginTop: "2px", color: "#334155" }}>{words}</div>

            {showBank && (
              <div style={{ marginTop: "12px", fontSize: "11px" }}>
                <div style={{ fontWeight: "700", textDecoration: "underline" }}>Bank Transfer Details:</div>
                <div>Bank: {seller.bankName}</div>
                <div>Account No: {seller.bankAccountNo}</div>
                <div>IFSC Code: {seller.bankIfsc}</div>
                {showUpi && <div>UPI ID: {seller.upiId}</div>}
              </div>
            )}
          </div>

          <div style={{ padding: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
              <span>Taxable Value:</span>
              <span>₹{invoice.subtotalTaxable.toFixed(2)}</span>
            </div>
            {invoice.isInterState ? (
              <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                <span>IGST:</span>
                <span>₹{invoice.igstTotal.toFixed(2)}</span>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                  <span>CGST:</span>
                  <span>₹{invoice.cgstTotal.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                  <span>SGST:</span>
                  <span>₹{invoice.sgstTotal.toFixed(2)}</span>
                </div>
              </>
            )}
            {invoice.roundOffAmount !== 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                <span>Round-off (Sec 170):</span>
                <span>₹{invoice.roundOffAmount.toFixed(2)}</span>
              </div>
            )}
            <div style={{ borderTop: "1.5px solid #0f172a", margin: "6px 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", fontWeight: "800" }}>
              <span>Grand Total:</span>
              <span>₹{invoice.grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Declaration, Terms & Signatory */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", border: "1px solid #cbd5e1", padding: "10px" }}>
          <div>
            {showTerms && (
              <div style={{ marginBottom: "6px" }}>
                <div style={{ fontSize: "10px", fontWeight: "700" }}>Terms & Conditions:</div>
                <div style={{ fontSize: "10px", color: "#64748b", whiteSpace: "pre-line" }}>
                  {seller.termsAndConditions}
                </div>
              </div>
            )}
            <div style={{ fontSize: "10px", fontWeight: "700" }}>Declaration:</div>
            <div style={{ fontSize: "10px", color: "#64748b" }}>
              {footerNote}
            </div>
          </div>
          <div style={{ textAlign: "right", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ fontSize: "11px", fontWeight: "700" }}>For {sellerTitle}</div>
            {showSignature && (
              <div>
                {seller.signatureUrl && (
                  <div style={{ marginBottom: "4px" }}>
                    <img src={seller.signatureUrl} alt="Signature" style={{ maxHeight: "36px", maxWidth: "120px", objectFit: "contain" }} />
                  </div>
                )}
                <div style={{ fontSize: "10px", color: "#64748b" }}>({signatureLabel})</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
