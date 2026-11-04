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
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { evaluateInvoiceRules } from "../services/gst-engine";
import { InfoTip } from "../components/InfoTip";

const TEMPLATE_OPTIONS = [
  { label: "Standard B2B", value: "standard_b2b" },
  { label: "Modern D2C", value: "modern_d2c" },
  { label: "Minimalist", value: "minimalist" },
  { label: "Thermal Receipt (80mm)", value: "thermal_pos" },
];

const templateName = (id: string) => TEMPLATE_OPTIONS.find((t) => t.value === id)?.label || id;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const setting = await prisma.storeSetting.findUnique({ where: { shop: session.shop } });

  return json({
    setting: {
      autoGenerateTrigger: setting?.autoGenerateTrigger || "on_fulfill",
      invoicePrefix: setting?.invoicePrefix || "INV/{FY}/",
      nextInvoiceNumber: String(setting?.nextInvoiceNumber ?? 1),
      b2bInvoicePrefix: setting?.b2bInvoicePrefix || "B2B/{FY}/",
      nextB2BInvoiceNumber: String(setting?.nextB2BInvoiceNumber ?? 1),
      creditNotePrefix: setting?.creditNotePrefix || "CN/{FY}/",
      nextCreditNoteNumber: String(setting?.nextCreditNoteNumber ?? 1),
      invoiceTemplate: setting?.invoiceTemplate || "standard_b2b",
      b2bForceTemplate: setting?.b2bForceTemplate ?? true,
      b2bForcedTemplate: setting?.b2bForcedTemplate || "standard_b2b",
      amountRulesEnabled: setting?.amountRulesEnabled ?? false,
      highValueThreshold: String(setting?.highValueThreshold ?? 10000),
      highValueTemplate: setting?.highValueTemplate || "standard_b2b",
      lowValueThreshold: String(setting?.lowValueThreshold ?? 1000),
      lowValueTemplate: setting?.lowValueTemplate || "modern_d2c",
      ewayBillNoticeThreshold: String(setting?.ewayBillNoticeThreshold ?? 50000),
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const text = (key: string) => ((formData.get(key) as string) || "").trim();
  const amount = (key: string, fallback: number) => {
    const value = parseFloat(text(key));
    return value >= 0 ? value : fallback;
  };
  const current = await prisma.storeSetting.findUnique({ where: { shop } });

  // Lowering a counter would reissue numbers that are already on invoices.
  const nextNumber = (key: string, saved: number | undefined) =>
    Math.max(parseInt(text(key), 10) || 1, saved ?? 1);

  const data = {
    autoGenerateTrigger: text("autoGenerateTrigger") === "on_create" ? "on_create" : "on_fulfill",
    invoicePrefix: text("invoicePrefix") || "INV/{FY}/",
    nextInvoiceNumber: nextNumber("nextInvoiceNumber", current?.nextInvoiceNumber),
    b2bInvoicePrefix: text("b2bInvoicePrefix") || "B2B/{FY}/",
    nextB2BInvoiceNumber: nextNumber("nextB2BInvoiceNumber", current?.nextB2BInvoiceNumber),
    creditNotePrefix: text("creditNotePrefix") || "CN/{FY}/",
    nextCreditNoteNumber: nextNumber("nextCreditNoteNumber", current?.nextCreditNoteNumber),
    b2bForceTemplate: text("b2bForceTemplate") === "true",
    b2bForcedTemplate: text("b2bForcedTemplate") || "standard_b2b",
    amountRulesEnabled: text("amountRulesEnabled") === "true",
    highValueThreshold: amount("highValueThreshold", 10000),
    highValueTemplate: text("highValueTemplate") || "standard_b2b",
    lowValueThreshold: amount("lowValueThreshold", 1000),
    lowValueTemplate: text("lowValueTemplate") || "modern_d2c",
    ewayBillNoticeThreshold: amount("ewayBillNoticeThreshold", 50000),
  };

  await prisma.storeSetting.upsert({ where: { shop }, update: data, create: { shop, ...data } });

  const lowered =
    parseInt(text("nextInvoiceNumber"), 10) < data.nextInvoiceNumber ||
    parseInt(text("nextB2BInvoiceNumber"), 10) < data.nextB2BInvoiceNumber ||
    parseInt(text("nextCreditNoteNumber"), 10) < data.nextCreditNoteNumber;

  return json({
    success: true,
    message: lowered
      ? "Rules saved. Next numbers can't go below the current ones, so those stayed the same."
      : "Rules saved.",
  });
};

export default function InvoiceRulesPage() {
  const { setting } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [form, setForm] = useState(setting);
  const set = (key: keyof typeof setting) => (value: string | boolean) => setForm((prev) => ({ ...prev, [key]: value }));

  const [testAmount, setTestAmount] = useState("15000");
  const [testGstin, setTestGstin] = useState("");
  const [testResult, setTestResult] = useState<ReturnType<typeof evaluateInvoiceRules> | null>(null);

  const handleSave = () => {
    const fd = new FormData();
    Object.entries(form).forEach(([key, value]) => fd.append(key, String(value)));
    submit(fd, { method: "post" });
  };

  const handleTest = () => {
    setTestResult(
      evaluateInvoiceRules(
        { totalAmount: parseFloat(testAmount) || 0, buyerGstin: testGstin.trim().toUpperCase() || null },
        {
          invoicePrefix: form.invoicePrefix,
          nextInvoiceNumber: parseInt(form.nextInvoiceNumber, 10) || 1,
          b2bInvoicePrefix: form.b2bInvoicePrefix,
          b2bForceTemplate: form.b2bForceTemplate,
          b2bForcedTemplate: form.b2bForcedTemplate,
          defaultTemplate: form.invoiceTemplate,
          amountRulesEnabled: form.amountRulesEnabled,
          highValueThreshold: parseFloat(form.highValueThreshold),
          highValueTemplate: form.highValueTemplate,
          lowValueThreshold: parseFloat(form.lowValueThreshold),
          lowValueTemplate: form.lowValueTemplate,
          ewayBillNoticeThreshold: parseFloat(form.ewayBillNoticeThreshold),
        }
      )
    );
  };

  return (
    <Page
      titleMetadata={<InfoTip content="Sets when invoices are created, how they are numbered, and which design each order uses." />}
      title="Rules & Routing"
      subtitle="When invoices are created, how they are numbered, and which design they use"
      primaryAction={{ content: "Save Rules", onAction: handleSave, loading: navigation.state === "submitting" }}
    >
      <BlockStack gap="400">
        {actionData && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">1. When to Create Invoices</Text>
            <Select
              label="Create the invoice"
              options={[
                { label: "When the order is fulfilled", value: "on_fulfill" },
                { label: "As soon as the order is placed", value: "on_create" },
              ]}
              value={form.autoGenerateTrigger}
              onChange={set("autoGenerateTrigger")}
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">2. Numbering</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {"{FY}"} becomes the financial year, like 2026-27. Next numbers can only go up, so an invoice number is never reused.
            </Text>
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <TextField label="Invoice Prefix" value={form.invoicePrefix} onChange={set("invoicePrefix")} autoComplete="off" />
              <TextField label="Next Invoice Number" type="number" min={1} value={form.nextInvoiceNumber} onChange={set("nextInvoiceNumber")} autoComplete="off" />
              <TextField label="B2B Invoice Prefix" value={form.b2bInvoicePrefix} onChange={set("b2bInvoicePrefix")} autoComplete="off" />
              <TextField label="Next B2B Number" type="number" min={1} value={form.nextB2BInvoiceNumber} onChange={set("nextB2BInvoiceNumber")} autoComplete="off" />
              <TextField label="Credit Note Prefix" value={form.creditNotePrefix} onChange={set("creditNotePrefix")} autoComplete="off" />
              <TextField label="Next Credit Note Number" type="number" min={1} value={form.nextCreditNoteNumber} onChange={set("nextCreditNoteNumber")} autoComplete="off" />
            </InlineGrid>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">3. Which Design to Use</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {`Rules below are checked in order. If none apply, the default design from the Template Editor is used (currently ${templateName(form.invoiceTemplate)}).`}
            </Text>

            <Checkbox
              label="Orders with a GSTIN (B2B) always use one design"
              checked={form.b2bForceTemplate}
              onChange={set("b2bForceTemplate")}
            />
            {form.b2bForceTemplate && (
              <Select label="B2B design" options={TEMPLATE_OPTIONS} value={form.b2bForcedTemplate} onChange={set("b2bForcedTemplate")} />
            )}

            <Divider />

            <Checkbox
              label="Choose the design by order value"
              checked={form.amountRulesEnabled}
              onChange={set("amountRulesEnabled")}
            />
            {form.amountRulesEnabled && (
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                <TextField label="High value: orders from" type="number" prefix="₹" value={form.highValueThreshold} onChange={set("highValueThreshold")} autoComplete="off" />
                <Select label="High value design" options={TEMPLATE_OPTIONS} value={form.highValueTemplate} onChange={set("highValueTemplate")} />
                <TextField label="Low value: orders up to" type="number" prefix="₹" value={form.lowValueThreshold} onChange={set("lowValueThreshold")} autoComplete="off" />
                <Select label="Low value design" options={TEMPLATE_OPTIONS} value={form.lowValueTemplate} onChange={set("lowValueTemplate")} />
              </InlineGrid>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">4. e-Way Bill Reminder</Text>
            <TextField
              label="Flag invoices from this amount"
              type="number"
              prefix="₹"
              helpText="Marks the invoice so you remember to create an e-Way Bill on the government portal. The usual limit is ₹50,000."
              value={form.ewayBillNoticeThreshold}
              onChange={set("ewayBillNoticeThreshold")}
              autoComplete="off"
            />
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Test Your Rules</Text>
            <Text as="p" variant="bodySm" tone="subdued">Uses the values on this page, even before you save.</Text>
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <TextField label="Order total" type="number" prefix="₹" value={testAmount} onChange={setTestAmount} autoComplete="off" />
              <TextField label="Buyer GSTIN (leave blank for B2C)" value={testGstin} onChange={setTestGstin} autoComplete="off" />
            </InlineGrid>
            <div>
              <Button onClick={handleTest}>Test</Button>
            </div>
            {testResult && (
              <BlockStack gap="100">
                <Text as="p">{`Design: ${templateName(testResult.selectedTemplate)}`}</Text>
                <Text as="p">{`Number series: ${testResult.invoicePrefix}`}</Text>
                <Text as="p">{`e-Way Bill reminder: ${testResult.ewayBillRequired ? "Yes" : "No"}`}</Text>
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
