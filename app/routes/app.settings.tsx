import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineGrid,
  TextField,
  Button,
  Banner,
  Divider,
  Text,
  Checkbox,
  InlineStack,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getStateCodeFromGSTIN, GST_STATE_CODES } from "../services/gst-engine";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const setting = await prisma.storeSetting.findUnique({ where: { shop } });
  return json({
    setting: setting || {
      legalName: "",
      tradeName: "",
      gstin: "",
      addressLine1: "",
      city: "",
      state: "Maharashtra",
      stateCode: "27",
      pincode: "",
      invoicePrefix: "INV/{FY}/",
      nextInvoiceNumber: 1,
      bankName: "",
      bankAccountNo: "",
      bankIfsc: "",
      upiId: "",
      termsAndConditions: "Goods once sold will not be taken back without valid reasons.",
      roundOffSection170: true,
      autoEmailInvoice: true,
      einvoiceEnabled: false,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const gstin = (formData.get("gstin") as string || "").trim().toUpperCase();
  const stateCode = getStateCodeFromGSTIN(gstin) || (formData.get("stateCode") as string) || "27";
  const state = GST_STATE_CODES[stateCode]?.name || "Maharashtra";

  await prisma.storeSetting.upsert({
    where: { shop },
    update: {
      legalName: formData.get("legalName") as string,
      tradeName: formData.get("tradeName") as string,
      gstin,
      state,
      stateCode,
      addressLine1: formData.get("addressLine1") as string,
      city: formData.get("city") as string,
      pincode: formData.get("pincode") as string,
      invoicePrefix: formData.get("invoicePrefix") as string || "INV/{FY}/",
      bankName: formData.get("bankName") as string,
      bankAccountNo: formData.get("bankAccountNo") as string,
      bankIfsc: formData.get("bankIfsc") as string,
      upiId: formData.get("upiId") as string,
      termsAndConditions: formData.get("termsAndConditions") as string,
      roundOffSection170: formData.get("roundOffSection170") === "true",
      autoEmailInvoice: formData.get("autoEmailInvoice") === "true",
      einvoiceEnabled: formData.get("einvoiceEnabled") === "true",
    },
    create: {
      shop,
      legalName: formData.get("legalName") as string,
      tradeName: formData.get("tradeName") as string,
      gstin,
      state,
      stateCode,
      addressLine1: formData.get("addressLine1") as string,
      city: formData.get("city") as string,
      pincode: formData.get("pincode") as string,
      invoicePrefix: formData.get("invoicePrefix") as string || "INV/{FY}/",
      bankName: formData.get("bankName") as string,
      bankAccountNo: formData.get("bankAccountNo") as string,
      bankIfsc: formData.get("bankIfsc") as string,
      upiId: formData.get("upiId") as string,
      termsAndConditions: formData.get("termsAndConditions") as string,
      roundOffSection170: formData.get("roundOffSection170") === "true",
      autoEmailInvoice: formData.get("autoEmailInvoice") === "true",
      einvoiceEnabled: formData.get("einvoiceEnabled") === "true",
    },
  });

  return json({ success: true, message: "Settings saved successfully!" });
};

export default function SettingsPage() {
  const { setting } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [form, setForm] = useState(setting);

  const handleGstinChange = (value: string) => {
    const clean = value.toUpperCase();
    const stCode = getStateCodeFromGSTIN(clean);
    setForm((prev: any) => ({
      ...prev,
      gstin: clean,
      stateCode: stCode || prev.stateCode,
      state: stCode ? GST_STATE_CODES[stCode]?.name : prev.state,
    }));
  };

  const handleSave = () => {
    const fd = new FormData();
    Object.entries(form).forEach(([key, val]) => {
      fd.append(key, String(val ?? ""));
    });
    submit(fd, { method: "post" });
  };

  return (
    <Page
      title="GST Settings & Business Profile"
      subtitle="Configure your tax profile, invoice serials, bank details and compliance toggles"
      primaryAction={{
        content: "Save Changes",
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

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Business GSTIN & Legal Identity</Text>
            <Divider />
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <TextField
                label="Supplier GSTIN (15 Digits)"
                value={form.gstin || ""}
                onChange={handleGstinChange}
                placeholder="27AABCU9603R1ZM"
                autoComplete="off"
                helpText="Auto-identifies your Registered State and Code"
              />
              <TextField
                label="Registered State"
                value={`${form.stateCode || "27"} - ${form.state || "Maharashtra"}`}
                disabled
                autoComplete="off"
              />
              <TextField
                label="Legal Entity Name (As per GST Certificate)"
                value={form.legalName || ""}
                onChange={(val) => setForm({ ...form, legalName: val })}
                autoComplete="off"
              />
              <TextField
                label="Trade / Brand Name"
                value={form.tradeName || ""}
                onChange={(val) => setForm({ ...form, tradeName: val })}
                autoComplete="off"
              />
            </InlineGrid>

            <Divider />
            <Text as="h3" variant="headingSm">Registered Business Address</Text>
            <TextField
              label="Address Line 1"
              value={form.addressLine1 || ""}
              onChange={(val) => setForm({ ...form, addressLine1: val })}
              autoComplete="off"
            />
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <TextField
                label="City"
                value={form.city || ""}
                onChange={(val) => setForm({ ...form, city: val })}
                autoComplete="off"
              />
              <TextField
                label="Pincode"
                value={form.pincode || ""}
                onChange={(val) => setForm({ ...form, pincode: val })}
                autoComplete="off"
              />
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* Invoice Numbering */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Invoice Numbering & Rule 46 Rules</Text>
            <Divider />
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <TextField
                label="Invoice Prefix Template"
                value={form.invoicePrefix || "INV/{FY}/"}
                onChange={(val) => setForm({ ...form, invoicePrefix: val })}
                helpText="Use {FY} for current Financial Year (e.g. 2026-27)"
                autoComplete="off"
              />
              <TextField
                label="Next Serial Number"
                type="number"
                value={String(form.nextInvoiceNumber || 1)}
                onChange={(val) => setForm({ ...form, nextInvoiceNumber: parseInt(val, 10) || 1 })}
                autoComplete="off"
              />
            </InlineGrid>

            <Checkbox
              label="Section 170 Rupee Rounding (Rounds invoice to nearest whole rupee)"
              checked={Boolean(form.roundOffSection170)}
              onChange={(checked) => setForm({ ...form, roundOffSection170: checked })}
            />
            <Checkbox
              label="Automatically Email PDF Invoice to Customer upon Fulfillment"
              checked={Boolean(form.autoEmailInvoice)}
              onChange={(checked) => setForm({ ...form, autoEmailInvoice: checked })}
            />
          </BlockStack>
        </Card>

        {/* Bank & Payment Details */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Bank Details & UPI for Invoices</Text>
            <Divider />
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <TextField
                label="Bank Name"
                value={form.bankName || ""}
                onChange={(val) => setForm({ ...form, bankName: val })}
                autoComplete="off"
              />
              <TextField
                label="Account Number"
                value={form.bankAccountNo || ""}
                onChange={(val) => setForm({ ...form, bankAccountNo: val })}
                autoComplete="off"
              />
              <TextField
                label="IFSC Code"
                value={form.bankIfsc || ""}
                onChange={(val) => setForm({ ...form, bankIfsc: val })}
                autoComplete="off"
              />
              <TextField
                label="UPI ID / VPA (For dynamic QR Code)"
                value={form.upiId || ""}
                onChange={(val) => setForm({ ...form, upiId: val })}
                autoComplete="off"
              />
            </InlineGrid>
            <TextField
              label="Terms and Conditions (Printed at bottom of invoice)"
              multiline={3}
              value={form.termsAndConditions || ""}
              onChange={(val) => setForm({ ...form, termsAndConditions: val })}
              autoComplete="off"
            />
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
