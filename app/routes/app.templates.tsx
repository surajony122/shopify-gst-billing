import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  TextField,
  Banner,
  Text,
  Button,
  Checkbox,
  InlineGrid,
  InlineStack,
  Select,
} from "@shopify/polaris";
import { useEffect, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { InvoiceHTMLPreview } from "../components/InvoiceHTMLPreview";
import { isAllowedLogoUrl } from "../services/gst-engine";
import { openSecureFile } from "../utils/secure-file";
import { InfoTip } from "../components/InfoTip";

/** Reads the logo from Settings > Brand. The Admin API doesn't expose it, so this uses the public storefront API. */
async function fetchShopifyBrandLogo(shop: string): Promise<string | null> {
  try {
    const response = await fetch(`https://${shop}/api/2025-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        query: `{ shop { brand {
          logo { image { url(transform: { preferredContentType: PNG, maxWidth: 600 }) } }
          squareLogo { image { url(transform: { preferredContentType: PNG, maxWidth: 600 }) } }
        } } }`,
      }),
    });
    const body = (await response.json()) as any;
    const brand = body.data?.shop?.brand;
    const url: string | undefined = brand?.logo?.image?.url || brand?.squareLogo?.image?.url;
    return url && isAllowedLogoUrl(url) ? url : null;
  } catch (error) {
    console.warn("Could not fetch brand logo", error);
    return null;
  }
}

/** Upload control for small images, stored directly so no extra Shopify permission is needed. */
function ImageField({ label, helpText, value, onChange, children }: {
  label: string;
  helpText?: string;
  value: string;
  onChange: (value: string) => void;
  children?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 500_000) {
      setError("Choose a PNG or JPG under 500 KB.");
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <BlockStack gap="150">
      <Text as="span" variant="bodyMd">{label}</Text>
      {value && (
        <img src={value} alt={label} style={{ maxHeight: "70px", maxWidth: "200px", objectFit: "contain", alignSelf: "flex-start" }} />
      )}
      <InlineStack gap="200">
        {children}
        <Button onClick={() => inputRef.current?.click()}>Upload</Button>
        {value && <Button tone="critical" variant="plain" onClick={() => onChange("")}>Remove</Button>}
      </InlineStack>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        style={{ display: "none" }}
        onChange={(event) => {
          handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {error && <Text as="p" variant="bodySm" tone="critical">{error}</Text>}
      {helpText && <Text as="p" variant="bodySm" tone="subdued">{helpText}</Text>}
    </BlockStack>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const setting = await prisma.storeSetting.findUnique({ where: { shop: session.shop } });

  return json({
    paid: setting?.plan === "Growth" || setting?.plan === "Pro",
    form: {
      invoiceTemplate: setting?.invoiceTemplate || "standard_b2b",
      brandColor: setting?.brandColor || "#212B36",
      logoUrl: setting?.logoUrl || "",
      showSignature: setting?.showSignature ?? true,
      signatureUrl: setting?.signatureUrl || "",
      showBankDetails: setting?.showBankDetails ?? true,
      showUpiQr: setting?.showUpiQr ?? true,
      showTerms: setting?.showTerms ?? true,
      termsAndConditions: setting?.termsAndConditions || "",
      signatureLabel: setting?.signatureLabel || "Authorized Signatory",
      footerNote: setting?.footerNote || "",
    },
    seller: {
      legalName: setting?.legalName || "Your Legal Name",
      tradeName: setting?.tradeName || "",
      gstin: setting?.gstin || "Your GSTIN",
      panNumber: setting?.panNumber || "",
      addressLine1: setting?.addressLine1 || "Your address",
      city: setting?.city || "City",
      state: setting?.state || "Maharashtra",
      stateCode: setting?.stateCode || "27",
      pincode: setting?.pincode || "",
      phone: setting?.phone || "",
      email: setting?.email || "",
      bankName: setting?.bankName || "",
      bankAccountNo: setting?.bankAccountNo || "",
      bankIfsc: setting?.bankIfsc || "",
      upiId: setting?.upiId || "",
      taxScheme: setting?.taxScheme || "regular",
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const text = (key: string) => ((formData.get(key) as string) || "").trim();

  if (text("intent") === "fetch_logo") {
    const logoUrl = await fetchShopifyBrandLogo(shop);
    if (!logoUrl) {
      return json({
        success: false,
        message: "Couldn't get a logo from Shopify. Add one under Settings > Brand and make sure your store has no password, or upload it here.",
      });
    }
    return json({ success: true, message: "Logo fetched from Shopify. Click Save Template to keep it.", logoUrl });
  }

  const logoUrl = text("logoUrl");
  if (logoUrl && !isAllowedLogoUrl(logoUrl)) {
    return json({ success: false, message: "Logo must be a PNG or JPG under 500 KB." });
  }
  const signatureUrl = text("signatureUrl");
  if (signatureUrl && !isAllowedLogoUrl(signatureUrl)) {
    return json({ success: false, message: "Signature must be a PNG or JPG under 500 KB." });
  }
  const brandColor = text("brandColor");
  if (!/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
    return json({ success: false, message: "Brand color must look like #212B36." });
  }

  const data = {
    invoiceTemplate: text("invoiceTemplate") || "standard_b2b",
    brandColor,
    logoUrl: logoUrl || null,
    showLogo: Boolean(logoUrl),
    showSignature: text("showSignature") === "true",
    signatureUrl: signatureUrl || null,
    showBankDetails: text("showBankDetails") === "true",
    showUpiQr: text("showUpiQr") === "true",
    showTerms: text("showTerms") === "true",
    termsAndConditions: text("termsAndConditions") || null,
    signatureLabel: text("signatureLabel") || "Authorized Signatory",
    footerNote: text("footerNote") || null,
  };

  await prisma.storeSetting.upsert({ where: { shop }, update: data, create: { shop, ...data } });
  return json({ success: true, message: "Template saved." });
};

const SAMPLE_INVOICE = {
  id: "sample-preview",
  invoiceNumber: "INV/2026-27/0042",
  orderNumber: "1042",
  financialYear: "2026-27",
  date: "16/10/2026",
  orderDate: "16/10/2026",
  isB2B: true,
  buyerGstin: "29AABCB1234F1Z5",
  buyerTradeName: "Sample Buyer Pvt Ltd",
  buyerPhone: "+91 90000 00000",
  buyerEmail: "buyer@example.com",
  placeOfSupplyState: "Karnataka",
  placeOfSupplyCode: "29",
  isInterState: true,
  subtotalTaxable: 2500,
  cgstTotal: 0,
  sgstTotal: 0,
  igstTotal: 255,
  roundOffAmount: 0,
  grandTotal: 2755,
  ewayBillRequired: false,
  lineItems: [
    { id: "1", title: "Cotton T-Shirt", variantTitle: "Black / XL", sku: "", hsnCode: "610910", quantity: 2, unitPrice: 750, discountAmount: 0, taxableValue: 1500, gstRate: 5, cgstAmount: 0, sgstAmount: 0, igstAmount: 75, totalAmount: 1575 },
    { id: "2", title: "Wireless Charger", variantTitle: "Grey", sku: "", hsnCode: "850440", quantity: 1, unitPrice: 1000, discountAmount: 0, taxableValue: 1000, gstRate: 18, cgstAmount: 0, sgstAmount: 0, igstAmount: 180, totalAmount: 1180 },
  ],
};

export default function TemplateEditorPage() {
  const { paid, form: saved, seller } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [form, setForm] = useState(saved);
  const set = (key: keyof typeof saved) => (value: string | boolean) => setForm((prev) => ({ ...prev, [key]: value }));
  const isThermal = form.invoiceTemplate === "thermal_pos";
  const isFetchingLogo = navigation.formData?.get("intent") === "fetch_logo";

  const fetchedLogo = actionData && "logoUrl" in actionData ? actionData.logoUrl : undefined;
  useEffect(() => {
    if (fetchedLogo) setForm((prev) => ({ ...prev, logoUrl: fetchedLogo as string }));
  }, [fetchedLogo]);

  const handleFetchLogo = () => {
    const fd = new FormData();
    fd.append("intent", "fetch_logo");
    submit(fd, { method: "post" });
  };

  const handleSave = () => {
    const fd = new FormData();
    Object.entries(form).forEach(([key, value]) => fd.append(key, String(value)));
    submit(fd, { method: "post" });
  };

  return (
    <Page
      titleMetadata={<InfoTip content="Controls how your invoices look. The preview uses a sample order. Save to apply your changes to invoice PDFs." />}
      title="Template Editor"
      subtitle="Choose your invoice design. The preview updates as you type."
      fullWidth
      primaryAction={{ content: "Save Template", onAction: handleSave, loading: navigation.state === "submitting" }}
      secondaryActions={[
        {
          content: "Open Saved PDF",
          helpText: "Shows a sample PDF using your last saved settings",
          onAction: () => {
            openSecureFile(`/api/invoices/preview?template=${saved.invoiceTemplate}`).catch((error) => window.alert(error.message));
          },
        },
      ]}
    >
      <BlockStack gap="400">
        {!paid && (
          <Banner tone="info" title="Free plan uses the Standard template">
            <p>Other templates, your logo and your signature print on Growth and Pro. You can start a 7-day free trial in Plan & Billing.</p>
          </Banner>
        )}
        {actionData && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        <InlineGrid columns={{ xs: "1fr", lg: "400px 1fr" }} gap="400">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Design</Text>
                <Select
                  label="Template"
                  options={[
                    { label: "Standard B2B (full tax format)", value: "standard_b2b" },
                    { label: "Modern D2C (brand color header)", value: "modern_d2c" },
                    { label: "Minimalist (black and white)", value: "minimalist" },
                    { label: "Thermal Receipt (80mm printer)", value: "thermal_pos" },
                  ]}
                  value={form.invoiceTemplate}
                  onChange={set("invoiceTemplate")}
                />
                {!isThermal && (
                  <>
                    <InlineGrid columns="1fr auto" gap="200" alignItems="end">
                      <TextField label="Brand Color" value={form.brandColor} onChange={set("brandColor")} autoComplete="off" />
                      <input
                        type="color"
                        aria-label="Pick brand color"
                        value={/^#[0-9a-fA-F]{6}$/.test(form.brandColor) ? form.brandColor : "#212B36"}
                        onChange={(event) => set("brandColor")(event.target.value)}
                        style={{ width: "40px", height: "32px", border: "none", background: "none", cursor: "pointer" }}
                      />
                    </InlineGrid>
                    <ImageField
                      label="Logo"
                      helpText="Fetch uses the logo in Shopify under Settings > Brand. You can also upload a PNG or JPG under 500 KB."
                      value={form.logoUrl}
                      onChange={set("logoUrl")}
                    >
                      <Button onClick={handleFetchLogo} loading={isFetchingLogo}>Fetch from Shopify</Button>
                    </ImageField>
                  </>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Show on Invoice</Text>
                <Checkbox label="Bank details" checked={form.showBankDetails} onChange={set("showBankDetails")} disabled={isThermal} />
                <Checkbox label="UPI payment QR code" checked={form.showUpiQr} onChange={set("showUpiQr")} />
                <Checkbox label="Terms and conditions" checked={form.showTerms} onChange={set("showTerms")} disabled={isThermal} />
                <Text as="p" variant="bodySm" tone="subdued">Enter your bank and UPI details in GST Settings.</Text>
              </BlockStack>
            </Card>

            {!isThermal && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Signature</Text>
                  <Checkbox label="Show signature or seal image" checked={form.showSignature} onChange={set("showSignature")} />
                  {form.showSignature && (
                    <ImageField
                      label="Signature or seal"
                      helpText="A PNG with a transparent background looks best. Without an image, space is left for signing by hand."
                      value={form.signatureUrl}
                      onChange={set("signatureUrl")}
                    />
                  )}
                  <TextField label="Label below signature" value={form.signatureLabel} onChange={set("signatureLabel")} autoComplete="off" />
                </BlockStack>
              </Card>
            )}

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Text</Text>
                {form.showTerms && !isThermal && (
                  <TextField label="Terms and Conditions" multiline={3} value={form.termsAndConditions} onChange={set("termsAndConditions")} autoComplete="off" />
                )}
                <TextField label="Footer Note" value={form.footerNote} onChange={set("footerNote")} placeholder="Thank you for shopping with us!" autoComplete="off" />
              </BlockStack>
            </Card>
          </BlockStack>

          <div style={{ position: "sticky", top: "20px" }}>
            <Card padding="300">
              <BlockStack gap="200">
                <Text as="h2" variant="headingSm">Preview with sample order</Text>
                <div style={{ maxHeight: "80vh", overflowY: "auto", border: "1px solid #e1e3e5", borderRadius: "8px", background: "#f6f6f7" }}>
                  <InvoiceHTMLPreview
                    invoice={SAMPLE_INVOICE}
                    template={form.invoiceTemplate}
                    seller={{
                      ...seller,
                      brandColor: form.brandColor,
                      logoUrl: form.logoUrl,
                      showLogo: Boolean(form.logoUrl),
                      showBankDetails: form.showBankDetails,
                      showUpiQr: form.showUpiQr,
                      showTerms: form.showTerms,
                      termsAndConditions: form.termsAndConditions,
                      showHsnSummary: false,
                      showSku: false,
                      showSignature: form.showSignature,
                      signatureLabel: form.signatureLabel,
                      signatureUrl: form.signatureUrl,
                      footerNote: form.footerNote,
                    }}
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
