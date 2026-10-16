import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineGrid,
  TextField,
  Select,
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
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { evaluateInvoiceRules, resolveItemGstRate, resolveShippingGstRate } from "../services/gst-engine";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const setting = await prisma.storeSetting.findUnique({ where: { shop } });

  return json({
    setting: setting || {
      invoiceTemplate: "standard_b2b",
      brandColor: "#212B36",
      b2bInvoicePrefix: "B2B/{FY}/",
      nextB2BInvoiceNumber: 1,
      b2bForceTemplate: true,
      b2bForcedTemplate: "standard_b2b",
      amountRulesEnabled: false,
      highValueThreshold: 10000.0,
      highValueTemplate: "standard_b2b",
      lowValueThreshold: 1000.0,
      lowValueTemplate: "modern_d2c",
      ewayBillNoticeThreshold: 50000.0,
      apparelFootwearTierRule: true,
      shippingTaxMode: "fixed_18",
      hsnLengthRequired: 6,
      roundOffSection170: true,
      autoGenerateTrigger: "on_fulfill",
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_rules") {
    await prisma.storeSetting.upsert({
      where: { shop },
      update: {
        invoiceTemplate: formData.get("invoiceTemplate") as string || "standard_b2b",
        brandColor: formData.get("brandColor") as string || "#212B36",
        b2bInvoicePrefix: formData.get("b2bInvoicePrefix") as string || "B2B/{FY}/",
        b2bForceTemplate: formData.get("b2bForceTemplate") === "true",
        b2bForcedTemplate: formData.get("b2bForcedTemplate") as string || "standard_b2b",
        amountRulesEnabled: formData.get("amountRulesEnabled") === "true",
        highValueThreshold: parseFloat(formData.get("highValueThreshold") as string || "10000"),
        highValueTemplate: formData.get("highValueTemplate") as string || "standard_b2b",
        lowValueThreshold: parseFloat(formData.get("lowValueThreshold") as string || "1000"),
        lowValueTemplate: formData.get("lowValueTemplate") as string || "modern_d2c",
        ewayBillNoticeThreshold: parseFloat(formData.get("ewayBillNoticeThreshold") as string || "50000"),
        apparelFootwearTierRule: formData.get("apparelFootwearTierRule") === "true",
        shippingTaxMode: formData.get("shippingTaxMode") as string || "fixed_18",
        hsnLengthRequired: parseInt(formData.get("hsnLengthRequired") as string || "6", 10),
        roundOffSection170: formData.get("roundOffSection170") === "true",
        autoGenerateTrigger: formData.get("autoGenerateTrigger") as string || "on_fulfill",
      },
      create: {
        shop,
        invoiceTemplate: formData.get("invoiceTemplate") as string || "standard_b2b",
        brandColor: formData.get("brandColor") as string || "#212B36",
        b2bInvoicePrefix: formData.get("b2bInvoicePrefix") as string || "B2B/{FY}/",
        b2bForceTemplate: formData.get("b2bForceTemplate") === "true",
        b2bForcedTemplate: formData.get("b2bForcedTemplate") as string || "standard_b2b",
        amountRulesEnabled: formData.get("amountRulesEnabled") === "true",
        highValueThreshold: parseFloat(formData.get("highValueThreshold") as string || "10000"),
        highValueTemplate: formData.get("highValueTemplate") as string || "standard_b2b",
        lowValueThreshold: parseFloat(formData.get("lowValueThreshold") as string || "1000"),
        lowValueTemplate: formData.get("lowValueTemplate") as string || "modern_d2c",
        ewayBillNoticeThreshold: parseFloat(formData.get("ewayBillNoticeThreshold") as string || "50000"),
        apparelFootwearTierRule: formData.get("apparelFootwearTierRule") === "true",
        shippingTaxMode: formData.get("shippingTaxMode") as string || "fixed_18",
        hsnLengthRequired: parseInt(formData.get("hsnLengthRequired") as string || "6", 10),
        roundOffSection170: formData.get("roundOffSection170") === "true",
        autoGenerateTrigger: formData.get("autoGenerateTrigger") as string || "on_fulfill",
      },
    });

    return json({
      success: true,
      message: "Invoice templates & dynamic rules updated successfully!",
    });
  }

  return json({ success: false, message: "Invalid action" });
};

export default function InvoiceRulesPage() {
  const { setting } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [selectedTab, setSelectedTab] = useState(0);
  const [form, setForm] = useState(setting);

  // Simulator State
  const [simAmount, setSimAmount] = useState("15000");
  const [simIsB2B, setSimIsB2B] = useState(true);
  const [simGstin, setSimGstin] = useState("29AABCU9603R1ZM");
  const [simHsn, setSimHsn] = useState("6203");
  const [simItemPrice, setSimItemPrice] = useState("1200");
  const [simulationResult, setSimulationResult] = useState<any>(null);

  const tabs = [
    { id: "templates", content: "Invoice Templates (4 Designs)" },
    { id: "amount-rules", content: "Amount-Based Rules" },
    { id: "hsn-rules", content: "HSN & Tiered Tax Rules" },
    { id: "b2b-global", content: "B2B & Global Rules" },
    { id: "simulator", content: "Interactive Rule Simulator" },
  ];

  const handleSave = () => {
    const fd = new FormData();
    fd.append("intent", "save_rules");
    Object.entries(form).forEach(([key, val]) => {
      fd.append(key, String(val ?? ""));
    });
    submit(fd, { method: "post" });
  };

  const handleRunSimulation = () => {
    const orderTotal = parseFloat(simAmount) || 0;
    const itemPrice = parseFloat(simItemPrice) || 0;

    const evaluated = evaluateInvoiceRules(
      {
        totalAmount: orderTotal,
        buyerGstin: simIsB2B ? simGstin : null,
        lineItems: [{ hsnCode: simHsn, unitPrice: itemPrice }],
      },
      {
        invoicePrefix: form.invoicePrefix || "INV/{FY}/",
        nextInvoiceNumber: form.nextInvoiceNumber || 1,
        b2bInvoicePrefix: form.b2bInvoicePrefix,
        b2bForceTemplate: form.b2bForceTemplate,
        b2bForcedTemplate: form.b2bForcedTemplate,
        defaultTemplate: form.invoiceTemplate,
        amountRulesEnabled: form.amountRulesEnabled,
        highValueThreshold: form.highValueThreshold,
        highValueTemplate: form.highValueTemplate,
        lowValueThreshold: form.lowValueThreshold,
        lowValueTemplate: form.lowValueTemplate,
        ewayBillNoticeThreshold: form.ewayBillNoticeThreshold,
        apparelFootwearTierRule: form.apparelFootwearTierRule,
        shippingTaxMode: form.shippingTaxMode,
        roundOffSection170: form.roundOffSection170,
      }
    );

    const hsnRateResult = resolveItemGstRate(
      simHsn,
      itemPrice,
      18,
      form.apparelFootwearTierRule
    );

    const shippingRate = resolveShippingGstRate(form.shippingTaxMode, [hsnRateResult.rate]);

    setSimulationResult({
      ...evaluated,
      itemGstRate: hsnRateResult.rate,
      hsnRuleNote: hsnRateResult.ruleApplied,
      shippingRate,
    });
  };

  const templatesList = [
    {
      id: "standard_b2b",
      title: "Standard Indian B2B",
      badge: "Rule 46 Compliant",
      badgeTone: "success" as const,
      description: "Traditional boxed layout with detailed HSN tax breakup grid, Buyer & Seller GSTIN/PAN, Bank Details, Declaration & Signatory.",
      idealFor: "Wholesale, B2B, Electronics, Machinery, Corporate Billing",
      format: "A4 Portrait",
    },
    {
      id: "modern_d2c",
      title: "Modern D2C Clean",
      badge: "E-Commerce Hero",
      badgeTone: "info" as const,
      description: "Full-width brand header banner, modern typography, card-like customer address container, clean zebra table, and grand total badge.",
      idealFor: "Fashion, Cosmetics, Lifestyle, Consumer Brands, Online Retail",
      format: "A4 Portrait",
    },
    {
      id: "minimalist",
      title: "Minimalist Studio",
      badge: "Luxury & Modern",
      badgeTone: "attention" as const,
      description: "Monochrome, high-contrast typography, delicate hairline dividers (0.2mm), understated totals, and generous breathing room.",
      idealFor: "Designer Apparel, Jewellery, Perfumes, Premium Artisanal Goods",
      format: "A4 Portrait",
    },
    {
      id: "thermal_pos",
      title: "Compact Thermal Receipt (80mm)",
      badge: "Warehouse POS Roll",
      badgeTone: "warning" as const,
      description: "Real 80mm continuous roll slip. Monospace text, dashed dividers, compact table, UPI QR code. Perfect for warehouse packaging slips.",
      idealFor: "Parcel Box Inserts, Retail Counters, Quick Dispatch Logistics",
      format: "80mm Roll Width",
    },
  ];

  return (
    <Page
      title="Invoice Templates & Rules Engine"
      subtitle="Configure multi-template invoice designs, amount routing, HSN price-tier slabs, and statutory compliance rules"
      primaryAction={{
        content: "Save Rules",
        onAction: handleSave,
        loading: navigation.state === "submitting",
      }}
    >
      <BlockStack gap="500">
        {actionData?.success && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            {/* TAB 0: TEMPLATES SHOWROOM */}
            {selectedTab === 0 && (
              <Box padding="500">
                <BlockStack gap="500">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">Available Invoice Templates</Text>
                    <Text as="p" tone="subdued">
                      Choose your default invoice style or configure rules to switch templates dynamically based on order type or cart amount.
                    </Text>
                  </BlockStack>

                  {/* Brand Color Chooser */}
                  <Card>
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">Brand Accent Color</Text>
                        <Text as="p" tone="subdued">Used for table headers, borders, and modern banner themes:</Text>
                      </BlockStack>
                      <InlineStack gap="200" blockAlign="center">
                        <div
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "6px",
                            backgroundColor: form.brandColor || "#212B36",
                            border: "2px solid #ccc",
                          }}
                        />
                        <TextField
                          label="Color Hex"
                          labelHidden
                          value={form.brandColor || "#212B36"}
                          onChange={(val) => setForm({ ...form, brandColor: val })}
                          autoComplete="off"
                        />
                      </InlineStack>
                    </InlineStack>
                  </Card>

                  <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                    {templatesList.map((tmpl) => {
                      const isSelected = (form.invoiceTemplate || "standard_b2b") === tmpl.id;
                      return (
                        <Card key={tmpl.id} background={isSelected ? "bg-surface-selected" : "bg-surface"}>
                          <BlockStack gap="300">
                            <InlineStack align="space-between">
                              <Text as="h3" variant="headingSm">{tmpl.title}</Text>
                              <Badge tone={tmpl.badgeTone}>{tmpl.badge}</Badge>
                            </InlineStack>
                            <Text as="p" variant="bodySm">{tmpl.description}</Text>
                            <Divider />
                            <BlockStack gap="100">
                              <Text as="p" variant="bodyXs" tone="subdued">Format: <strong>{tmpl.format}</strong></Text>
                              <Text as="p" variant="bodyXs" tone="subdued">Best For: <em>{tmpl.idealFor}</em></Text>
                            </BlockStack>
                            <InlineStack align="space-between" blockAlign="center">
                              {isSelected ? (
                                <Badge tone="success">Default Store Template</Badge>
                              ) : (
                                <Button
                                  size="micro"
                                  onClick={() => setForm({ ...form, invoiceTemplate: tmpl.id })}
                                >
                                  Set as Default
                                </Button>
                              )}
                              <Button
                                size="micro"
                                variant="primary"
                                url={`/api/invoices/preview?template=${tmpl.id}`}
                                target="_blank"
                              >
                                Preview Live PDF
                              </Button>
                            </InlineStack>
                          </BlockStack>
                        </Card>
                      );
                    })}
                  </InlineGrid>
                </BlockStack>
              </Box>
            )}

            {/* TAB 1: AMOUNT-BASED RULES */}
            {selectedTab === 1 && (
              <Box padding="500">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Amount-Based Invoicing Rules</Text>
                  <Text as="p" tone="subdued">
                    Automatically route invoices to different layout templates or trigger statutory notices based on the order total value:
                  </Text>
                  <Divider />

                  <Checkbox
                    label="Enable Dynamic Template Routing by Order Value"
                    helpText="Orders above or below specified thresholds will automatically use specialized templates"
                    checked={Boolean(form.amountRulesEnabled)}
                    onChange={(checked) => setForm({ ...form, amountRulesEnabled: checked })}
                  />

                  {form.amountRulesEnabled && (
                    <Card>
                      <BlockStack gap="400">
                        <Text as="h3" variant="headingSm">High-Value Order Routing</Text>
                        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                          <TextField
                            label="High-Value Order Threshold (INR)"
                            type="number"
                            prefix="₹"
                            value={String(form.highValueThreshold ?? 10000)}
                            onChange={(val) => setForm({ ...form, highValueThreshold: parseFloat(val) || 0 })}
                            autoComplete="off"
                            helpText="Orders greater than or equal to this amount"
                          />
                          <Select
                            label="Assign Invoice Template"
                            options={[
                              { label: "Standard Indian B2B (Traditional Full Tax Grid)", value: "standard_b2b" },
                              { label: "Modern D2C Clean", value: "modern_d2c" },
                              { label: "Minimalist Studio", value: "minimalist" },
                            ]}
                            value={form.highValueTemplate || "standard_b2b"}
                            onChange={(val) => setForm({ ...form, highValueTemplate: val })}
                          />
                        </InlineGrid>

                        <Divider />
                        <Text as="h3" variant="headingSm">Low-Value / Quick Parcel Routing</Text>
                        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                          <TextField
                            label="Low-Value Order Threshold (INR)"
                            type="number"
                            prefix="₹"
                            value={String(form.lowValueThreshold ?? 1000)}
                            onChange={(val) => setForm({ ...form, lowValueThreshold: parseFloat(val) || 0 })}
                            autoComplete="off"
                            helpText="Orders less than or equal to this amount"
                          />
                          <Select
                            label="Assign Invoice Template"
                            options={[
                              { label: "Compact Thermal Receipt (80mm POS Slip)", value: "thermal_pos" },
                              { label: "Modern D2C Clean", value: "modern_d2c" },
                              { label: "Minimalist Studio", value: "minimalist" },
                            ]}
                            value={form.lowValueTemplate || "modern_d2c"}
                            onChange={(val) => setForm({ ...form, lowValueTemplate: val })}
                          />
                        </InlineGrid>
                      </BlockStack>
                    </Card>
                  )}

                  <Card>
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Statutory e-Way Bill Threshold Notice (Rule 138)</Text>
                      <Text as="p" tone="subdued">
                        Under Indian GST Rule 138, consignments exceeding ₹50,000 require an electronic waybill.
                      </Text>
                      <TextField
                        label="e-Way Bill Consignment Value Notice Threshold (INR)"
                        type="number"
                        prefix="₹"
                        value={String(form.ewayBillNoticeThreshold ?? 50000)}
                        onChange={(val) => setForm({ ...form, ewayBillNoticeThreshold: parseFloat(val) || 50000 })}
                        autoComplete="off"
                        helpText="Invoices at or above this value will print an e-Way Bill mandatory compliance tag"
                      />
                    </BlockStack>
                  </Card>
                </BlockStack>
              </Box>
            )}

            {/* TAB 2: HSN & TIERED TAX RULES */}
            {selectedTab === 2 && (
              <Box padding="500">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">HSN & Price-Tier Tax Rules</Text>
                  <Text as="p" tone="subdued">
                    Enforce statutory Indian price-point tax brackets and composite supply shipping rules:
                  </Text>
                  <Divider />

                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text as="h3" variant="headingSm">Apparel & Footwear ₹1,000 Tier Rule</Text>
                        <Badge tone="info">Indian Statutory Rule</Badge>
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        Under GST HSN Chapters 61, 62 (Apparel & Garments) and Chapter 64 (Footwear), tax rates are strictly determined by the individual item unit price:
                      </Text>
                      <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                        <Text as="p" variant="bodySm">
                          • Item Unit Price <strong>≤ ₹1,000</strong>: Automatically taxed at <strong>5% GST</strong><br />
                          • Item Unit Price <strong>&gt; ₹1,000</strong>: Automatically taxed at <strong>12% GST</strong>
                        </Text>
                      </Box>
                      <Checkbox
                        label="Automatically enforce ₹1,000 price threshold for Apparel & Footwear HSNs (61, 62, 64)"
                        checked={Boolean(form.apparelFootwearTierRule)}
                        onChange={(checked) => setForm({ ...form, apparelFootwearTierRule: checked })}
                      />
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Shipping & Freight GST Rule (Composite Supply)</Text>
                      <Text as="p" tone="subdued">
                        Choose how GST is calculated on shipping fees according to Section 8(a) of the CGST Act:
                      </Text>
                      <Select
                        label="Shipping GST Calculation Mode"
                        options={[
                          { label: "Fixed 18% Standard GST on Shipping Fees", value: "fixed_18" },
                          { label: "Composite Supply: Dynamically match highest product GST rate in order", value: "composite_highest" },
                          { label: "0% GST Exempt (Free/Included Shipping)", value: "exempt_0" },
                        ]}
                        value={form.shippingTaxMode || "fixed_18"}
                        onChange={(val) => setForm({ ...form, shippingTaxMode: val })}
                        helpText="Composite Supply means delivery charges inherit the highest tax rate among the ordered products"
                      />
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">HSN Digit Length Requirement</Text>
                      <Select
                        label="Mandatory HSN Code Length"
                        options={[
                          { label: "6 Digits (Turnover > ₹5 Crore - Standard B2B & B2C)", value: "6" },
                          { label: "4 Digits (Turnover < ₹5 Crore - Small Taxpayers)", value: "4" },
                          { label: "8 Digits (Chemicals, Exports & International Trade)", value: "8" },
                        ]}
                        value={String(form.hsnLengthRequired ?? 6)}
                        onChange={(val) => setForm({ ...form, hsnLengthRequired: parseInt(val, 10) })}
                      />
                    </BlockStack>
                  </Card>
                </BlockStack>
              </Box>
            )}

            {/* TAB 3: B2B & GLOBAL RULES */}
            {selectedTab === 3 && (
              <Box padding="500">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">B2B Routing & Global Accounting Rules</Text>
                  <Text as="p" tone="subdued">
                    Configure specialized invoice sequence series and statutory rounding rules:
                  </Text>
                  <Divider />

                  <Card>
                    <BlockStack gap="400">
                      <Text as="h3" variant="headingSm">B2B Registered Buyer Series & Template</Text>
                      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                        <TextField
                          label="B2B Invoice Prefix Series"
                          value={form.b2bInvoicePrefix || "B2B/{FY}/"}
                          onChange={(val) => setForm({ ...form, b2bInvoicePrefix: val })}
                          helpText="Separate numbering series for B2B orders (e.g. B2B/2026-27/0001)"
                          autoComplete="off"
                        />
                        <Select
                          label="Force B2B Template for Registered Buyers"
                          options={[
                            { label: "Force Standard Indian B2B (Full Tax Grid & Signatory)", value: "standard_b2b" },
                            { label: "Allow default template", value: "none" },
                          ]}
                          value={form.b2bForceTemplate ? (form.b2bForcedTemplate || "standard_b2b") : "none"}
                          onChange={(val) => {
                            if (val === "none") {
                              setForm({ ...form, b2bForceTemplate: false });
                            } else {
                              setForm({ ...form, b2bForceTemplate: true, b2bForcedTemplate: val });
                            }
                          }}
                        />
                      </InlineGrid>
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Section 170 Rupee Rounding</Text>
                      <Checkbox
                        label="Section 170 Compliance: Automatically round invoice Grand Total to nearest whole Rupee"
                        checked={Boolean(form.roundOffSection170)}
                        onChange={(checked) => setForm({ ...form, roundOffSection170: checked })}
                        helpText="Fractions of a rupee under 50 paise are rounded down, 50 paise and above are rounded up."
                      />
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Invoice Generation Trigger Timing</Text>
                      <Select
                        label="When to Generate GST Invoices"
                        options={[
                          { label: "Generate only when Order is Fulfilled / Shipped (Recommended)", value: "on_fulfill" },
                          { label: "Generate immediately upon Order Placement", value: "on_create" },
                        ]}
                        value={form.autoGenerateTrigger || "on_fulfill"}
                        onChange={(val) => setForm({ ...form, autoGenerateTrigger: val })}
                      />
                    </BlockStack>
                  </Card>
                </BlockStack>
              </Box>
            )}

            {/* TAB 4: RULE SIMULATOR */}
            {selectedTab === 4 && (
              <Box padding="500">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Interactive Rule Simulator & Tester</Text>
                  <Text as="p" tone="subdued">
                    Simulate how your configured rules will evaluate an order and see the resulting template, invoice series, tax rate, and compliance tags:
                  </Text>
                  <Divider />

                  <Card>
                    <BlockStack gap="400">
                      <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                        <TextField
                          label="Order Total Amount (INR)"
                          type="number"
                          prefix="₹"
                          value={simAmount}
                          onChange={setSimAmount}
                          autoComplete="off"
                        />
                        <TextField
                          label="Item HSN Code"
                          value={simHsn}
                          onChange={setSimHsn}
                          helpText="Try 6203 (Apparel) or 8471 (Electronics)"
                          autoComplete="off"
                        />
                        <TextField
                          label="Item Unit Price (INR)"
                          type="number"
                          prefix="₹"
                          value={simItemPrice}
                          onChange={setSimItemPrice}
                          helpText="Try ₹850 vs ₹1,500 for Apparel tier test"
                          autoComplete="off"
                        />
                      </InlineGrid>

                      <Checkbox
                        label="Simulate B2B Order (Buyer provides registered GSTIN)"
                        checked={simIsB2B}
                        onChange={setSimIsB2B}
                      />

                      {simIsB2B && (
                        <TextField
                          label="Buyer GSTIN"
                          value={simGstin}
                          onChange={setSimGstin}
                          autoComplete="off"
                        />
                      )}

                      <div>
                        <Button variant="primary" onClick={handleRunSimulation}>
                          Run Rule Simulation
                        </Button>
                      </div>
                    </BlockStack>
                  </Card>

                  {simulationResult && (
                    <Card background="bg-surface-secondary">
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">Simulation Evaluation Result:</Text>
                        <Divider />
                        <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                          <Text as="p">Selected Invoice Template: <strong>{simulationResult.selectedTemplate}</strong></Text>
                          <Text as="p">Invoice Number Prefix: <strong>{simulationResult.invoicePrefix}</strong></Text>
                          <Text as="p">Calculated Item GST Rate: <strong>{simulationResult.itemGstRate}%</strong></Text>
                          <Text as="p">Calculated Shipping GST: <strong>{simulationResult.shippingRate}%</strong></Text>
                          <Text as="p">e-Way Bill Required: <strong>{simulationResult.ewayBillRequired ? "YES (Rule 138)" : "NO"}</strong></Text>
                          <Text as="p">High-Value PAN Required: <strong>{simulationResult.panMandatoryNotice ? "YES (Rule 114B)" : "NO"}</strong></Text>
                        </InlineGrid>
                        <Divider />
                        <Text as="p" variant="bodySm" fontWeight="bold">Rules Triggered Log:</Text>
                        <BlockStack gap="100">
                          {simulationResult.appliedRuleNotes.map((note: string, idx: number) => (
                            <Text key={idx} as="p" variant="bodyXs" tone="subdued">✔ {note}</Text>
                          ))}
                          {simulationResult.hsnRuleNote && (
                            <Text as="p" variant="bodyXs" tone="subdued">✔ {simulationResult.hsnRuleNote}</Text>
                          )}
                        </BlockStack>
                      </BlockStack>
                    </Card>
                  )}
                </BlockStack>
              </Box>
            )}
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}
