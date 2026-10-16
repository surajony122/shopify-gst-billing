import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  TextField,
  Button,
  Banner,
  Divider,
  Text,
  Checkbox,
  InlineStack,
  Badge,
  Tabs,
  Box,
  ButtonGroup,
  InlineGrid,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { InvoiceHTMLPreview } from "../components/InvoiceHTMLPreview";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const setting = await prisma.storeSetting.findUnique({ where: { shop } });

  return json({
    setting: setting || {
      invoiceTemplate: "standard_b2b",
      brandColor: "#212B36",
      legalName: "My Enterprise Ltd",
      tradeName: "SuperStore India",
      gstin: "27AABCU9603R1ZX",
      panNumber: "AABCU9603R",
      addressLine1: "Plot 45, Sector 18, Phase IV",
      city: "Mumbai",
      state: "Maharashtra",
      stateCode: "27",
      pincode: "400001",
      phone: "+91 98765 43210",
      email: "billing@superstore.in",
      bankName: "HDFC Bank",
      bankAccountNo: "50200012345678",
      bankIfsc: "HDFC0001234",
      upiId: "superstore@hdfcbank",
      termsAndConditions: "1. All disputes are subject to local jurisdiction only.\n2. Goods once sold will not be returned without original packaging and tags.",
      invoiceTitle: "TAX INVOICE",
      invoiceSubtitle: "Original for Recipient | Rule 46 CGST Act",
      showLogo: true,
      logoUrl: "",
      showBankDetails: true,
      showUpiQr: true,
      showTerms: true,
      showHsnSummary: true,
      showSku: false,
      showSignature: true,
      signatureLabel: "Authorized Signatory",
      signatureUrl: "",
      footerNote: "Thank you for shopping with us! For warranty support, visit support.superstore.in",
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_template") {
    await prisma.storeSetting.upsert({
      where: { shop },
      update: {
        invoiceTemplate: (formData.get("invoiceTemplate") as string) || "standard_b2b",
        brandColor: (formData.get("brandColor") as string) || "#212B36",
        invoiceTitle: (formData.get("invoiceTitle") as string) || "TAX INVOICE",
        invoiceSubtitle: (formData.get("invoiceSubtitle") as string) || "Original for Recipient | Rule 46 CGST Act",
        logoUrl: (formData.get("logoUrl") as string) || null,
        showLogo: formData.get("showLogo") === "true",
        showBankDetails: formData.get("showBankDetails") === "true",
        bankName: (formData.get("bankName") as string) || null,
        bankAccountNo: (formData.get("bankAccountNo") as string) || null,
        bankIfsc: (formData.get("bankIfsc") as string) || null,
        upiId: (formData.get("upiId") as string) || null,
        showUpiQr: formData.get("showUpiQr") === "true",
        showTerms: formData.get("showTerms") === "true",
        termsAndConditions: (formData.get("termsAndConditions") as string) || null,
        showHsnSummary: formData.get("showHsnSummary") === "true",
        showSku: formData.get("showSku") === "true",
        showSignature: formData.get("showSignature") === "true",
        signatureLabel: (formData.get("signatureLabel") as string) || "Authorized Signatory",
        signatureUrl: (formData.get("signatureUrl") as string) || null,
        footerNote: (formData.get("footerNote") as string) || "Thank you for shopping with us!",
      },
      create: {
        shop,
        invoiceTemplate: (formData.get("invoiceTemplate") as string) || "standard_b2b",
        brandColor: (formData.get("brandColor") as string) || "#212B36",
        invoiceTitle: (formData.get("invoiceTitle") as string) || "TAX INVOICE",
        invoiceSubtitle: (formData.get("invoiceSubtitle") as string) || "Original for Recipient | Rule 46 CGST Act",
        logoUrl: (formData.get("logoUrl") as string) || null,
        showLogo: formData.get("showLogo") === "true",
        showBankDetails: formData.get("showBankDetails") === "true",
        bankName: (formData.get("bankName") as string) || null,
        bankAccountNo: (formData.get("bankAccountNo") as string) || null,
        bankIfsc: (formData.get("bankIfsc") as string) || null,
        upiId: (formData.get("upiId") as string) || null,
        showUpiQr: formData.get("showUpiQr") === "true",
        showTerms: formData.get("showTerms") === "true",
        termsAndConditions: (formData.get("termsAndConditions") as string) || null,
        showHsnSummary: formData.get("showHsnSummary") === "true",
        showSku: formData.get("showSku") === "true",
        showSignature: formData.get("showSignature") === "true",
        signatureLabel: (formData.get("signatureLabel") as string) || "Authorized Signatory",
        signatureUrl: (formData.get("signatureUrl") as string) || null,
        footerNote: (formData.get("footerNote") as string) || "Thank you for shopping with us!",
      },
    });

    return json({
      success: true,
      message: "Invoice template customizations saved successfully! All newly generated and viewed invoices will reflect these settings.",
    });
  }

  return json({ success: false, message: "Unknown action" }, { status: 400 });
};

export default function TemplateEditorPage() {
  const { setting } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [selectedTab, setSelectedTab] = useState(0);

  // Form State for Live Interactive Editing
  const [form, setForm] = useState({
    invoiceTemplate: setting.invoiceTemplate || "standard_b2b",
    brandColor: setting.brandColor || "#212B36",
    invoiceTitle: (setting as any).invoiceTitle || "TAX INVOICE",
    invoiceSubtitle: (setting as any).invoiceSubtitle || "Original for Recipient | Rule 46 CGST Act",
    logoUrl: setting.logoUrl || "",
    showLogo: (setting as any).showLogo !== false,
    showBankDetails: (setting as any).showBankDetails !== false,
    bankName: setting.bankName || "HDFC Bank",
    bankAccountNo: setting.bankAccountNo || "50200012345678",
    bankIfsc: setting.bankIfsc || "HDFC0001234",
    upiId: setting.upiId || "superstore@hdfcbank",
    showUpiQr: (setting as any).showUpiQr !== false,
    showTerms: (setting as any).showTerms !== false,
    termsAndConditions: setting.termsAndConditions || "1. All disputes are subject to local jurisdiction only.\n2. Goods once sold will not be returned without original packaging and tags.",
    showHsnSummary: (setting as any).showHsnSummary !== false,
    showSku: Boolean((setting as any).showSku),
    showSignature: (setting as any).showSignature !== false,
    signatureLabel: (setting as any).signatureLabel || "Authorized Signatory",
    signatureUrl: (setting as any).signatureUrl || "",
    footerNote: (setting as any).footerNote || "Thank you for shopping with us! For warranty support, visit support.superstore.in",
  });

  // Preview Template Switcher
  const [activePreviewTemplate, setActivePreviewTemplate] = useState<string>(
    form.invoiceTemplate || "standard_b2b"
  );

  // Sample Invoice Data for Live WYSIWYG Rendering
  const sampleInvoice = {
    id: "sample-preview",
    invoiceNumber: "INV/2026-27/0042",
    orderNumber: "1042",
    financialYear: "2026-27",
    date: "16/10/2026",
    orderDate: "16/10/2026",
    isB2B: true,
    buyerGstin: "29AABCB1234F1Z5",
    buyerTradeName: "Acme Retail Enterprises Pvt Ltd",
    placeOfSupplyState: "Karnataka",
    placeOfSupplyCode: "29",
    isInterState: true,
    subtotalTaxable: 2500.0,
    cgstTotal: 0.0,
    sgstTotal: 0.0,
    igstTotal: 300.0,
    roundOffAmount: 0.0,
    grandTotal: 2800.0,
    ewayBillRequired: false,
    lineItems: [
      {
        id: "sample-item-1",
        title: "Pure Cotton Premium Round Neck T-Shirt",
        variantTitle: "Black / XL",
        sku: "TSH-BLK-XL",
        hsnCode: "61091000",
        quantity: 2,
        unitPrice: 750.0,
        discountAmount: 0,
        taxableValue: 1500.0,
        gstRate: 12.0,
        cgstAmount: 0.0,
        sgstAmount: 0.0,
        igstAmount: 180.0,
        totalAmount: 1680.0,
      },
      {
        id: "sample-item-2",
        title: "Magnetic Wireless Fast Charging Dock",
        variantTitle: "Space Grey",
        sku: "CHG-WRL-GRY",
        hsnCode: "85044090",
        quantity: 1,
        unitPrice: 1000.0,
        discountAmount: 0,
        taxableValue: 1000.0,
        gstRate: 12.0,
        cgstAmount: 0.0,
        sgstAmount: 0.0,
        igstAmount: 120.0,
        totalAmount: 1120.0,
      },
    ],
  };

  const previewSeller = {
    legalName: setting.legalName || "My Enterprise Ltd",
    tradeName: setting.tradeName || "SuperStore India",
    gstin: setting.gstin || "27AABCU9603R1ZX",
    panNumber: setting.panNumber || "AABCU9603R",
    addressLine1: setting.addressLine1 || "Plot 45, Sector 18, Phase IV",
    city: setting.city || "Mumbai",
    state: setting.state || "Maharashtra",
    stateCode: setting.stateCode || "27",
    pincode: setting.pincode || "400001",
    phone: setting.phone || "+91 98765 43210",
    email: setting.email || "billing@superstore.in",
    taxScheme: setting.taxScheme || "regular",
    brandColor: form.brandColor,
    invoiceTitle: form.invoiceTitle,
    invoiceSubtitle: form.invoiceSubtitle,
    logoUrl: form.logoUrl,
    showLogo: form.showLogo,
    showBankDetails: form.showBankDetails,
    bankName: form.bankName,
    bankAccountNo: form.bankAccountNo,
    bankIfsc: form.bankIfsc,
    upiId: form.upiId,
    showUpiQr: form.showUpiQr,
    showTerms: form.showTerms,
    termsAndConditions: form.termsAndConditions,
    showHsnSummary: form.showHsnSummary,
    showSku: form.showSku,
    showSignature: form.showSignature,
    signatureLabel: form.signatureLabel,
    signatureUrl: form.signatureUrl,
    footerNote: form.footerNote,
  };

  const handleSave = () => {
    const fd = new FormData();
    fd.append("intent", "save_template");
    fd.append("invoiceTemplate", form.invoiceTemplate);
    fd.append("brandColor", form.brandColor);
    fd.append("invoiceTitle", form.invoiceTitle);
    fd.append("invoiceSubtitle", form.invoiceSubtitle);
    fd.append("logoUrl", form.logoUrl);
    fd.append("showLogo", String(form.showLogo));
    fd.append("showBankDetails", String(form.showBankDetails));
    fd.append("bankName", form.bankName);
    fd.append("bankAccountNo", form.bankAccountNo);
    fd.append("bankIfsc", form.bankIfsc);
    fd.append("upiId", form.upiId);
    fd.append("showUpiQr", String(form.showUpiQr));
    fd.append("showTerms", String(form.showTerms));
    fd.append("termsAndConditions", form.termsAndConditions);
    fd.append("showHsnSummary", String(form.showHsnSummary));
    fd.append("showSku", String(form.showSku));
    fd.append("showSignature", String(form.showSignature));
    fd.append("signatureLabel", form.signatureLabel);
    fd.append("signatureUrl", form.signatureUrl);
    fd.append("footerNote", form.footerNote);

    submit(fd, { method: "post" });
  };

  const handleTestPrint = () => {
    const printArea = document.getElementById("invoice-printable-area");
    if (!printArea) return;
    const printWin = window.open("", "_blank");
    if (!printWin) return;
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Print - ${form.invoiceTitle}</title>
          <style>
            body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
            @media print {
              body { padding: 0; margin: 0; }
              #invoice-printable-area { box-shadow: none !important; width: 100% !important; margin: 0 !important; }
            }
          </style>
        </head>
        <body>
          ${printArea.outerHTML}
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWin.document.close();
  };

  const tabs = [
    { id: "layout", content: "Layout & Base Style" },
    { id: "branding", content: "Branding & Headers" },
    { id: "columns", content: "Columns & Tax Breakdown" },
    { id: "banking", content: "Bank & UPI Payments" },
    { id: "footer", content: "Terms, Footers & Signature" },
  ];

  const templatesList = [
    {
      id: "standard_b2b",
      title: "Standard Traditional B2B",
      desc: "Comprehensive statutory format with full tax breakdown and HSN summary table.",
      tag: "Statutory",
    },
    {
      id: "modern_d2c",
      title: "Modern D2C Retail",
      desc: "Clean branded header banner, customer cards, and modern typography.",
      tag: "Branded D2C",
    },
    {
      id: "minimalist",
      title: "Minimalist Studio",
      desc: "Monochrome, high-end hairline divider aesthetic suited for lifestyle brands.",
      tag: "Boutique",
    },
    {
      id: "thermal_pos",
      title: "Thermal POS (80mm)",
      desc: "Compact receipt roll format optimized for thermal receipt printers.",
      tag: "Receipt",
    },
  ];

  return (
    <Page
      title="Invoice Template Customizer"
      subtitle="Customize your invoice design, brand colors, headings, columns, bank details, and declarations with real-time interactive preview."
      fullWidth
      primaryAction={{
        content: isSaving ? "Saving..." : "Save Template Settings",
        onAction: handleSave,
        loading: isSaving,
      }}
      secondaryActions={[
        {
          content: "Print Test Sample",
          onAction: handleTestPrint,
        },
      ]}
    >
      <BlockStack gap="400">
        {actionData?.success && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        <InlineGrid columns={{ xs: "1fr", lg: "480px 1fr" }} gap="400">
          {/* LEFT COLUMN: CUSTOMIZATION CONTROLS */}
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              {/* TAB 0: LAYOUT & BASE STYLE */}
              {selectedTab === 0 && (
                <Box padding="400">
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingSm">Select Default Template Style</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Choose which base format to use as your store's primary invoice layout.
                    </Text>

                    <BlockStack gap="300">
                      {templatesList.map((t) => {
                        const isDefault = form.invoiceTemplate === t.id;
                        return (
                          <div
                            key={t.id}
                            onClick={() => {
                              setForm({ ...form, invoiceTemplate: t.id });
                              setActivePreviewTemplate(t.id);
                            }}
                            style={{
                              border: isDefault ? "2px solid #008060" : "1px solid #dcdcdc",
                              borderRadius: "8px",
                              padding: "12px 14px",
                              cursor: "pointer",
                              backgroundColor: isDefault ? "#f0fdf4" : "#ffffff",
                              transition: "all 0.15s ease",
                            }}
                          >
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="span" variant="bodyMd" fontWeight="bold">
                                {t.title}
                              </Text>
                              <InlineStack gap="200" blockAlign="center">
                                <Badge tone="info">{t.tag}</Badge>
                                {isDefault && <Badge tone="success">Active Default</Badge>}
                              </InlineStack>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued" style={{ marginTop: "4px" }}>
                              {t.desc}
                            </Text>
                          </div>
                        );
                      })}
                    </BlockStack>
                  </BlockStack>
                </Box>
              )}

              {/* TAB 1: BRANDING & HEADERS */}
              {selectedTab === 1 && (
                <Box padding="400">
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingSm">Branding & Document Titles</Text>

                    {/* Brand Accent Color */}
                    <Card>
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" fontWeight="bold">Brand Accent Color</Text>
                          <Text as="p" variant="bodyXs" tone="subdued">Used for table headers and banners:</Text>
                        </BlockStack>
                        <InlineStack gap="200" blockAlign="center">
                          <input
                            type="color"
                            value={form.brandColor || "#212B36"}
                            onChange={(e) => setForm({ ...form, brandColor: e.target.value })}
                            style={{
                              width: "36px",
                              height: "36px",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                            }}
                          />
                          <div style={{ width: "100px" }}>
                            <TextField
                              label="Hex"
                              labelHidden
                              value={form.brandColor}
                              onChange={(val) => setForm({ ...form, brandColor: val })}
                              autoComplete="off"
                            />
                          </div>
                        </InlineStack>
                      </InlineStack>
                    </Card>

                    {/* Store Logo */}
                    <Card>
                      <BlockStack gap="200">
                        <Checkbox
                          label="Show Store Logo on Invoices"
                          checked={form.showLogo}
                          onChange={(chk) => setForm({ ...form, showLogo: chk })}
                        />
                        {form.showLogo && (
                          <TextField
                            label="Logo Image URL"
                            value={form.logoUrl}
                            onChange={(val) => setForm({ ...form, logoUrl: val })}
                            placeholder="https://yourstore.com/logo.png"
                            helpText="Enter a publicly accessible PNG or JPEG URL of your store logo."
                            autoComplete="off"
                          />
                        )}
                        {form.showLogo && form.logoUrl && (
                          <div style={{ padding: "8px", background: "#f8f9fa", borderRadius: "6px", textAlign: "center" }}>
                            <img src={form.logoUrl} alt="Logo Preview" style={{ maxHeight: "40px", maxWidth: "180px", objectFit: "contain" }} />
                          </div>
                        )}
                      </BlockStack>
                    </Card>

                    {/* Document Title & Subtitle */}
                    <Card>
                      <BlockStack gap="300">
                        <TextField
                          label="Invoice Heading / Title"
                          value={form.invoiceTitle}
                          onChange={(val) => setForm({ ...form, invoiceTitle: val })}
                          helpText="Statutory default: TAX INVOICE or BILL OF SUPPLY"
                          autoComplete="off"
                        />
                        <TextField
                          label="Invoice Sub-heading / Citation"
                          value={form.invoiceSubtitle}
                          onChange={(val) => setForm({ ...form, invoiceSubtitle: val })}
                          helpText="E.g., Original for Recipient | Rule 46 CGST Act"
                          autoComplete="off"
                        />
                      </BlockStack>
                    </Card>
                  </BlockStack>
                </Box>
              )}

              {/* TAB 2: COLUMNS & CONTENT */}
              {selectedTab === 2 && (
                <Box padding="400">
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingSm">Table Columns & Breakdown</Text>
                    <Card>
                      <BlockStack gap="300">
                        <Checkbox
                          label="Show Product SKU Column"
                          helpText="Display individual product SKU codes next to or under item titles."
                          checked={form.showSku}
                          onChange={(chk) => setForm({ ...form, showSku: chk })}
                        />
                        <Divider />
                        <Checkbox
                          label="Show HSN-wise Statutory Tax Breakdown Table"
                          helpText="Statutory table at the bottom aggregating taxable value, CGST, SGST, and IGST by HSN/SAC code."
                          checked={form.showHsnSummary}
                          onChange={(chk) => setForm({ ...form, showHsnSummary: chk })}
                        />
                      </BlockStack>
                    </Card>
                  </BlockStack>
                </Box>
              )}

              {/* TAB 3: BANK & UPI PAYMENTS */}
              {selectedTab === 3 && (
                <Box padding="400">
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingSm">Banking & UPI Payment Info</Text>
                    <Card>
                      <BlockStack gap="300">
                        <Checkbox
                          label="Display Bank Account Details on Invoices"
                          helpText="Allows B2B clients and customers to pay via NEFT / RTGS / IMPS."
                          checked={form.showBankDetails}
                          onChange={(chk) => setForm({ ...form, showBankDetails: chk })}
                        />

                        {form.showBankDetails && (
                          <BlockStack gap="200">
                            <TextField
                              label="Bank Name"
                              value={form.bankName}
                              onChange={(val) => setForm({ ...form, bankName: val })}
                              autoComplete="off"
                            />
                            <TextField
                              label="Account Number"
                              value={form.bankAccountNo}
                              onChange={(val) => setForm({ ...form, bankAccountNo: val })}
                              autoComplete="off"
                            />
                            <TextField
                              label="IFSC Code"
                              value={form.bankIfsc}
                              onChange={(val) => setForm({ ...form, bankIfsc: val.toUpperCase() })}
                              autoComplete="off"
                            />
                          </BlockStack>
                        )}

                        <Divider />

                        <Checkbox
                          label="Enable UPI Pay Option"
                          helpText="Show UPI VPA ID on the invoice for instant payments."
                          checked={form.showUpiQr}
                          onChange={(chk) => setForm({ ...form, showUpiQr: chk })}
                        />

                        {form.showUpiQr && (
                          <TextField
                            label="UPI Virtual Payment Address (VPA)"
                            value={form.upiId}
                            onChange={(val) => setForm({ ...form, upiId: val })}
                            placeholder="store@icici or 9876543210@paytm"
                            autoComplete="off"
                          />
                        )}
                      </BlockStack>
                    </Card>
                  </BlockStack>
                </Box>
              )}

              {/* TAB 4: TERMS & SIGNATURE */}
              {selectedTab === 4 && (
                <Box padding="400">
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingSm">Terms, Footers & Signatory</Text>
                    <Card>
                      <BlockStack gap="300">
                        <Checkbox
                          label="Display Terms & Conditions"
                          checked={form.showTerms}
                          onChange={(chk) => setForm({ ...form, showTerms: chk })}
                        />

                        {form.showTerms && (
                          <TextField
                            label="Terms & Conditions Text"
                            value={form.termsAndConditions}
                            onChange={(val) => setForm({ ...form, termsAndConditions: val })}
                            multiline={3}
                            autoComplete="off"
                          />
                        )}

                        <Divider />

                        <TextField
                          label="Footer Greeting / Declaration Note"
                          value={form.footerNote}
                          onChange={(val) => setForm({ ...form, footerNote: val })}
                          placeholder="Thank you for shopping with us!"
                          helpText="Printed at the bottom of the invoice."
                          autoComplete="off"
                        />

                        <Divider />

                        <Checkbox
                          label="Show Authorized Signatory Section"
                          checked={form.showSignature}
                          onChange={(chk) => setForm({ ...form, showSignature: chk })}
                        />

                        {form.showSignature && (
                          <BlockStack gap="200">
                            <TextField
                              label="Signatory Title / Label"
                              value={form.signatureLabel}
                              onChange={(val) => setForm({ ...form, signatureLabel: val })}
                              placeholder="Authorized Signatory"
                              autoComplete="off"
                            />
                            <TextField
                              label="Digital Signature / Stamp Image URL"
                              value={form.signatureUrl}
                              onChange={(val) => setForm({ ...form, signatureUrl: val })}
                              placeholder="https://yourstore.com/signature.png"
                              helpText="Transparent PNG image recommended."
                              autoComplete="off"
                            />
                          </BlockStack>
                        )}
                      </BlockStack>
                    </Card>
                  </BlockStack>
                </Box>
              )}
            </Tabs>
          </Card>

          {/* RIGHT COLUMN: STICKY REAL-TIME LIVE PREVIEW */}
          <div style={{ position: "sticky", top: "20px" }}>
            <Card padding="300">
              <BlockStack gap="300">
                {/* Header Controls for Live Preview */}
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" variant="headingSm">Live Preview</Text>
                    <Badge tone="success">Real-Time Reactive</Badge>
                  </InlineStack>

                  <ButtonGroup variant="segmented">
                    <Button
                      size="micro"
                      pressed={activePreviewTemplate === "standard_b2b"}
                      onClick={() => setActivePreviewTemplate("standard_b2b")}
                    >
                      B2B
                    </Button>
                    <Button
                      size="micro"
                      pressed={activePreviewTemplate === "modern_d2c"}
                      onClick={() => setActivePreviewTemplate("modern_d2c")}
                    >
                      D2C
                    </Button>
                    <Button
                      size="micro"
                      pressed={activePreviewTemplate === "minimalist"}
                      onClick={() => setActivePreviewTemplate("minimalist")}
                    >
                      Minimal
                    </Button>
                    <Button
                      size="micro"
                      pressed={activePreviewTemplate === "thermal_pos"}
                      onClick={() => setActivePreviewTemplate("thermal_pos")}
                    >
                      Thermal
                    </Button>
                  </ButtonGroup>
                </InlineStack>

                <div
                  style={{
                    maxHeight: "75vh",
                    overflowY: "auto",
                    border: "1px solid #e1e3e5",
                    borderRadius: "8px",
                    background: "#f6f6f7",
                  }}
                >
                  <InvoiceHTMLPreview
                    invoice={sampleInvoice}
                    seller={previewSeller}
                    template={activePreviewTemplate}
                  />
                </div>
              </BlockStack>
            </Card>
          </div>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
