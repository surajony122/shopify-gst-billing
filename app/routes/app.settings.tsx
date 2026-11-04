import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSearchParams, useSubmit } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Box,
  InlineGrid,
  TextField,
  Button,
  Banner,
  Divider,
  Text,
  Checkbox,
  InlineStack,
  Pagination,
  Select,
  Tabs,
} from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { InfoTip } from "../components/InfoTip";
import { getStateCodeFromGSTIN, GST_STATE_CODES } from "../services/gst-engine";

const PAGE_SIZE = 50;
const TABS = ["business", "tax", "hsn"];

const gidNumber = (gid: string) => gid.split("/").pop() as string;

const RATE_OPTIONS = [
  { label: "0%", value: "0" },
  { label: "5%", value: "5" },
  { label: "18%", value: "18" },
  { label: "40%", value: "40" },
];

/** Keeps an older saved rate visible instead of silently showing a different one. */
function rateOptions(current?: string) {
  return current && !RATE_OPTIONS.some((o) => o.value === current)
    ? [...RATE_OPTIONS, { label: `${current}% (old rate)`, value: current }]
    : RATE_OPTIONS;
}

const SHIPPING_OPTIONS = [
  { label: "18%", value: "18" },
  { label: "5%", value: "5" },
  { label: "0% (exempt)", value: "0" },
  { label: "Same as the highest item rate in the order", value: "highest" },
];

function shippingChoice(setting: { shippingTaxMode?: string | null; shippingGstRate?: number | null }) {
  if (setting.shippingTaxMode === "composite_highest") return "highest";
  if (setting.shippingTaxMode === "exempt_0") return "0";
  return String(setting.shippingGstRate ?? 18);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "collections" ? "collections" : "products";

  const setting = await prisma.storeSetting.findUnique({ where: { shop } });

  let rows: Array<{ id: string; title: string; hsnCode: string; gstRate: string }> = [];
  let pageInfo = { hasNextPage: false, hasPreviousPage: false, startCursor: "", endCursor: "" };
  let loadFailed = false;

  if (url.searchParams.get("tab") === "hsn") {
    const before = url.searchParams.get("before");
    const after = url.searchParams.get("after");
    const search = (url.searchParams.get("q") || "").trim();
    const productMappings = await prisma.hsnCatalog.findMany({ where: { shop, shopifyVariantId: null } });
    const collectionMappings = await prisma.collectionHsn.findMany({ where: { shop } });

    try {
      const response = await admin.graphql(
        `query getCatalog($first: Int, $last: Int, $after: String, $before: String, $query: String) {
          ${kind}(first: $first, last: $last, after: $after, before: $before, query: $query, sortKey: TITLE) {
            nodes { id title }
            pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
          }
        }`,
        {
          variables: {
            first: before ? null : PAGE_SIZE,
            last: before ? PAGE_SIZE : null,
            after,
            before,
            query: search ? `title:*${search.replace(/["\\*:]/g, " ")}*` : null,
          },
        }
      );
      const body = (await response.json()) as any;
      pageInfo = body.data?.[kind]?.pageInfo || pageInfo;
      rows = (body.data?.[kind]?.nodes || []).map((node: any) => {
        const id = gidNumber(node.id);
        const mapping =
          kind === "products"
            ? productMappings.find((m) => m.shopifyProductId === id)
            : collectionMappings.find((m) => m.shopifyCollectionId === id);
        return {
          id,
          title: node.title,
          hsnCode: mapping?.hsnCode || "",
          gstRate: mapping ? String(mapping.gstRate) : "",
        };
      });
    } catch (err) {
      console.error("Error fetching catalog:", err);
      loadFailed = true;
    }
  }

  return json({
    setting: {
      gstin: setting?.gstin || "",
      stateCode: setting?.stateCode || "27",
      state: setting?.state || "Maharashtra",
      legalName: setting?.legalName || "",
      tradeName: setting?.tradeName || "",
      panNumber: setting?.panNumber || "",
      phone: setting?.phone || "",
      email: setting?.email || "",
      addressLine1: setting?.addressLine1 || "",
      addressLine2: setting?.addressLine2 || "",
      city: setting?.city || "",
      pincode: setting?.pincode || "",
      bankName: setting?.bankName || "",
      bankAccountNo: setting?.bankAccountNo || "",
      bankIfsc: setting?.bankIfsc || "",
      upiId: setting?.upiId || "",
      taxScheme: setting?.taxScheme || "regular",
      roundOffSection170: setting?.roundOffSection170 ?? true,
      shipping: shippingChoice(setting || {}),
      apparelFootwearTierRule: setting?.apparelFootwearTierRule ?? true,
      b2bStrictValidation: setting?.b2bStrictValidation ?? true,
      hsnLengthRequired: String(setting?.hsnLengthRequired ?? 6),
      defaultHsnCode: setting?.defaultHsnCode || "999999",
      defaultGstRate: String(setting?.defaultGstRate ?? 18),
    },
    kind,
    rows,
    pageInfo,
    loadFailed,
  });
};

const hsnError = (code: string, minLength: number) =>
  /^\d+$/.test(code) && code.length >= minLength && code.length <= 8
    ? null
    : `must be ${minLength} to 8 digits`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const text = (key: string) => ((formData.get(key) as string) || "").trim();

  if (intent === "save_settings") {
    const minLength = parseInt(text("hsnLengthRequired"), 10) || 6;
    const defaultHsnCode = text("defaultHsnCode") || "999999";
    if (defaultHsnCode !== "999999") {
      const error = hsnError(defaultHsnCode, minLength);
      if (error) return json({ success: false, message: `Default HSN code ${error}.` });
    }

    const gstin = text("gstin").toUpperCase();
    const stateCode = getStateCodeFromGSTIN(gstin) || text("stateCode") || "27";
    const shipping = text("shipping");
    const data = {
      gstin,
      stateCode,
      state: GST_STATE_CODES[stateCode]?.name || "Maharashtra",
      legalName: text("legalName"),
      tradeName: text("tradeName"),
      panNumber: text("panNumber").toUpperCase(),
      phone: text("phone"),
      email: text("email"),
      addressLine1: text("addressLine1"),
      addressLine2: text("addressLine2"),
      city: text("city"),
      pincode: text("pincode"),
      bankName: text("bankName"),
      bankAccountNo: text("bankAccountNo"),
      bankIfsc: text("bankIfsc").toUpperCase(),
      upiId: text("upiId"),
      taxScheme: text("taxScheme") === "composition" ? "composition" : "regular",
      roundOffSection170: text("roundOffSection170") === "true",
      shippingTaxMode: shipping === "highest" ? "composite_highest" : "fixed_18",
      shippingGstRate: shipping === "highest" ? 18 : parseFloat(shipping) || 0,
      apparelFootwearTierRule: text("apparelFootwearTierRule") === "true",
      b2bStrictValidation: text("b2bStrictValidation") === "true",
      hsnLengthRequired: minLength,
      defaultHsnCode,
      defaultGstRate: parseFloat(text("defaultGstRate")) || 0,
    };

    await prisma.storeSetting.upsert({ where: { shop }, update: data, create: { shop, ...data } });
    return json({ success: true, message: "Settings saved." });
  }

  if (intent === "save_hsn") {
    const kind = text("kind") === "collections" ? "collections" : "products";
    const rows: Array<{ id: string; title: string; hsnCode: string; gstRate: string }> = JSON.parse(text("rows") || "[]");
    const setting = await prisma.storeSetting.findUnique({ where: { shop } });
    const minLength = setting?.hsnLengthRequired ?? 6;

    for (const row of rows) {
      const code = row.hsnCode.trim();
      if (!code) continue;
      const error = hsnError(code, minLength);
      if (error) return json({ success: false, message: `HSN for "${row.title}" ${error}.` });
      if (!(parseFloat(row.gstRate) >= 0)) {
        return json({ success: false, message: `Choose a GST rate for "${row.title}".` });
      }
    }

    // All rows save together, so a failure never leaves a half-applied bulk edit.
    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const hsnCode = row.hsnCode.trim();
        const gstRate = parseFloat(row.gstRate);

        if (kind === "collections") {
          if (!hsnCode) {
            await tx.collectionHsn.deleteMany({ where: { shop, shopifyCollectionId: row.id } });
          } else {
            await tx.collectionHsn.upsert({
              where: { shop_shopifyCollectionId: { shop, shopifyCollectionId: row.id } },
              update: { hsnCode, gstRate, collectionTitle: row.title },
              create: { shop, shopifyCollectionId: row.id, collectionTitle: row.title, hsnCode, gstRate },
            });
          }
          continue;
        }

        // A null variant cannot be matched by the unique index, so look the row up first.
        const existing = await tx.hsnCatalog.findFirst({
          where: { shop, shopifyProductId: row.id, shopifyVariantId: null },
        });
        if (!hsnCode) {
          if (existing) await tx.hsnCatalog.delete({ where: { id: existing.id } });
        } else if (existing) {
          await tx.hsnCatalog.update({ where: { id: existing.id }, data: { hsnCode, gstRate, productTitle: row.title } });
        } else {
          await tx.hsnCatalog.create({ data: { shop, shopifyProductId: row.id, productTitle: row.title, hsnCode, gstRate } });
        }
      }
    });

    return json({ success: true, message: `Saved ${rows.length} HSN ${rows.length === 1 ? "code" : "codes"}.` });
  }

  return json({ success: false, message: "Invalid action" });
};

export default function SettingsPage() {
  const { setting, kind, rows, pageInfo, loadFailed } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSaving = navigation.state === "submitting";

  const tabIndex = Math.max(0, TABS.indexOf(searchParams.get("tab") || "business"));
  const tabs = [
    { id: "business", content: "Business Details" },
    { id: "tax", content: "Tax Rules" },
    { id: "hsn", content: "HSN Codes" },
  ];

  const [form, setForm] = useState(setting);
  const set = (key: keyof typeof setting) => (value: string | boolean) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleGstinChange = (value: string) => {
    const clean = value.toUpperCase();
    const code = getStateCodeFromGSTIN(clean);
    setForm((prev) => ({
      ...prev,
      gstin: clean,
      stateCode: code || prev.stateCode,
      state: code ? GST_STATE_CODES[code]?.name : prev.state,
    }));
  };

  const handleSaveSettings = () => {
    const fd = new FormData();
    fd.append("intent", "save_settings");
    Object.entries(form).forEach(([key, value]) => fd.append(key, String(value ?? "")));
    submit(fd, { method: "post" });
  };

  // ---------- HSN table ----------
  const [edits, setEdits] = useState<Record<string, { hsnCode: string; gstRate: string }>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkHsn, setBulkHsn] = useState("");
  const [bulkRate, setBulkRate] = useState("18");
  const [search, setSearch] = useState(searchParams.get("q") || "");

  // Fresh rows arrive after saving or changing page, so earlier edits no longer apply.
  useEffect(() => {
    setEdits({});
    setSelected([]);
  }, [rows]);

  const valueOf = (row: (typeof rows)[number]) => edits[row.id] || { hsnCode: row.hsnCode, gstRate: row.gstRate };
  const changedRows = useMemo(
    () => rows.filter((row) => edits[row.id] && (edits[row.id].hsnCode !== row.hsnCode || edits[row.id].gstRate !== row.gstRate)),
    [rows, edits]
  );

  const updateRow = (row: (typeof rows)[number], patch: Partial<{ hsnCode: string; gstRate: string }>) => {
    setEdits((prev) => {
      const next = { ...valueOf(row), ...patch };
      if (next.hsnCode && !next.gstRate) next.gstRate = form.defaultGstRate;
      return { ...prev, [row.id]: next };
    });
  };

  const applyBulk = () => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const id of selected) next[id] = { hsnCode: bulkHsn.trim(), gstRate: bulkHsn.trim() ? bulkRate : "" };
      return next;
    });
  };

  const handleSaveHsn = () => {
    const fd = new FormData();
    fd.append("intent", "save_hsn");
    fd.append("kind", kind);
    fd.append(
      "rows",
      JSON.stringify(changedRows.map((row) => ({ id: row.id, title: row.title, ...valueOf(row) })))
    );
    submit(fd, { method: "post" });
  };

  const goTo = (params: Record<string, string>) => {
    setSearchParams({ tab: "hsn", kind, ...(searchParams.get("q") ? { q: searchParams.get("q") as string } : {}), ...params });
  };

  const fallbackLabel = kind === "products" ? "Uses collection or store default" : "Uses store default";
  const allSelected = rows.length > 0 && selected.length === rows.length;

  return (
    <Page
      titleMetadata={
        <InfoTip
          content={
            ["Your business details print on every invoice.",
             "Tax rules decide how GST is calculated on new invoices.",
             "Each invoice line uses the product's HSN code, then its collection's, then the store default."][tabIndex]
          }
        />
      }
      title="GST Settings"
      subtitle="Your business details, tax rules and HSN codes"
      primaryAction={
        tabIndex === 2
          ? {
              content: changedRows.length > 0 ? `Save ${changedRows.length} HSN Changes` : "Save HSN Changes",
              onAction: handleSaveHsn,
              disabled: changedRows.length === 0,
              loading: isSaving,
            }
          : { content: "Save Settings", onAction: handleSaveSettings, loading: isSaving }
      }
    >
      <BlockStack gap="400">
        {actionData && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        <Card padding="0">
          <Tabs
            tabs={tabs}
            selected={tabIndex}
            onSelect={(index) => setSearchParams({ tab: TABS[index] })}
          />
        </Card>

        {tabIndex === 0 && (
          <>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Business Identity</Text>
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                  <TextField
                    label="GSTIN"
                    value={form.gstin}
                    onChange={handleGstinChange}
                    placeholder="27AABCU9603R1ZM"
                    helpText="Your registered state is detected from this"
                    autoComplete="off"
                  />
                  <TextField label="Registered State" value={`${form.stateCode} - ${form.state}`} disabled autoComplete="off" />
                  <TextField label="Legal Name (as on GST certificate)" value={form.legalName} onChange={set("legalName")} autoComplete="off" />
                  <TextField label="Trade / Brand Name" value={form.tradeName} onChange={set("tradeName")} autoComplete="off" />
                  <TextField label="PAN" value={form.panNumber} onChange={set("panNumber")} autoComplete="off" />
                  <TextField label="Business Phone" value={form.phone} onChange={set("phone")} autoComplete="off" />
                  <TextField label="Business Email" type="email" value={form.email} onChange={set("email")} autoComplete="off" />
                </InlineGrid>
                <Divider />
                <Text as="h2" variant="headingMd">Business Address</Text>
                <TextField label="Address Line 1" value={form.addressLine1} onChange={set("addressLine1")} autoComplete="off" />
                <TextField label="Address Line 2" value={form.addressLine2} onChange={set("addressLine2")} autoComplete="off" />
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                  <TextField label="City" value={form.city} onChange={set("city")} autoComplete="off" />
                  <TextField label="Pincode" value={form.pincode} onChange={set("pincode")} autoComplete="off" />
                </InlineGrid>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Bank & UPI</Text>
                <Text as="p" tone="subdued">Printed on invoices. Turn them on or off in the Template Editor.</Text>
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                  <TextField label="Bank Name" value={form.bankName} onChange={set("bankName")} autoComplete="off" />
                  <TextField label="Account Number" value={form.bankAccountNo} onChange={set("bankAccountNo")} autoComplete="off" />
                  <TextField label="IFSC Code" value={form.bankIfsc} onChange={set("bankIfsc")} autoComplete="off" />
                  <TextField label="UPI ID" value={form.upiId} onChange={set("upiId")} autoComplete="off" />
                </InlineGrid>
              </BlockStack>
            </Card>
          </>
        )}

        {tabIndex === 1 && (
          <>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Tax Calculation</Text>
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                  <Select
                    label="GST Scheme"
                    options={[
                      { label: "Regular (Tax Invoice with GST)", value: "regular" },
                      { label: "Composition (Bill of Supply, no GST charged)", value: "composition" },
                    ]}
                    value={form.taxScheme}
                    onChange={set("taxScheme")}
                  />
                  <Select
                    label="GST on Shipping Charges"
                    options={SHIPPING_OPTIONS}
                    value={form.shipping}
                    onChange={set("shipping")}
                  />
                </InlineGrid>
                <Checkbox
                  label="Round invoice totals to the nearest rupee (Section 170)"
                  checked={form.roundOffSection170}
                  onChange={set("roundOffSection170")}
                />
                <Checkbox
                  label="Apply the apparel and footwear price rule"
                  helpText="For HSN chapters 61, 62 and 64: 5% up to ₹2,500 per piece, 18% above it. This replaces any rate you set for these codes."
                  checked={form.apparelFootwearTierRule}
                  onChange={set("apparelFootwearTierRule")}
                />
                <Checkbox
                  label="Treat orders with an invalid GSTIN as B2C"
                  checked={form.b2bStrictValidation}
                  onChange={set("b2bStrictValidation")}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">HSN Defaults</Text>
                {form.defaultHsnCode === "999999" && (
                  <Banner tone="warning">
                    <p>999999 is only a placeholder. Enter your real HSN code before filing returns.</p>
                  </Banner>
                )}
                <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                  <TextField
                    label="Default HSN Code"
                    helpText="Used when a product and its collections have no code"
                    value={form.defaultHsnCode}
                    onChange={set("defaultHsnCode")}
                    autoComplete="off"
                  />
                  <Select
                    label="Default GST Rate"
                    options={rateOptions(form.defaultGstRate)}
                    value={form.defaultGstRate}
                    onChange={set("defaultGstRate")}
                  />
                  <Select
                    label="Minimum HSN Digits"
                    helpText="Based on your turnover. Ask your CA if unsure."
                    options={[
                      { label: "4 digits", value: "4" },
                      { label: "6 digits", value: "6" },
                      { label: "8 digits", value: "8" },
                    ]}
                    value={form.hsnLengthRequired}
                    onChange={set("hsnLengthRequired")}
                  />
                </InlineGrid>
              </BlockStack>
            </Card>
          </>
        )}

        {tabIndex === 2 && (
          <>
            {loadFailed && (
              <Banner tone="critical">
                <p>Could not load from Shopify. Reload the page to try again.</p>
              </Banner>
            )}

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="300" align="space-between" blockAlign="end" wrap>
                  <InlineStack gap="200" blockAlign="end">
                    <Button pressed={kind === "products"} onClick={() => setSearchParams({ tab: "hsn", kind: "products" })}>
                      Products
                    </Button>
                    <Button pressed={kind === "collections"} onClick={() => setSearchParams({ tab: "hsn", kind: "collections" })}>
                      Collections
                    </Button>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="end">
                    <TextField
                      label="Search by title"
                      labelHidden
                      placeholder="Search by title"
                      value={search}
                      onChange={setSearch}
                      autoComplete="off"
                    />
                    <Button onClick={() => setSearchParams({ tab: "hsn", kind, ...(search.trim() ? { q: search.trim() } : {}) })}>
                      Search
                    </Button>
                  </InlineStack>
                </InlineStack>

                <Text as="p" variant="bodySm" tone="subdued">
                  Each invoice line uses the product's code, then its collection's code, then the store default.
                  Clear a code to go back to the next one in that order.
                </Text>

                <Divider />

                <InlineStack gap="300" blockAlign="end" wrap>
                  <Text as="span" fontWeight="semibold">{`Bulk edit: ${selected.length} selected`}</Text>
                  <TextField label="HSN for selected" value={bulkHsn} onChange={setBulkHsn} autoComplete="off" />
                  <Select label="Rate for selected" options={RATE_OPTIONS} value={bulkRate} onChange={setBulkRate} />
                  <Button onClick={applyBulk} disabled={selected.length === 0}>Apply to Selected</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card padding="0">
              {rows.length === 0 ? (
                <Box padding="600">
                  <Text as="p" alignment="center" tone="subdued">Nothing found.</Text>
                </Box>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", background: "var(--p-color-bg-surface-secondary)" }}>
                        <th style={{ padding: "10px 12px", width: "40px" }}>
                          <Checkbox
                            label="Select all on this page"
                            labelHidden
                            checked={allSelected}
                            onChange={(checked) => setSelected(checked ? rows.map((row) => row.id) : [])}
                          />
                        </th>
                        <th style={{ padding: "10px 12px" }}><Text as="span" variant="bodySm" fontWeight="semibold">{kind === "products" ? "Product" : "Collection"}</Text></th>
                        <th style={{ padding: "10px 12px", width: "170px" }}><Text as="span" variant="bodySm" fontWeight="semibold">HSN Code</Text></th>
                        <th style={{ padding: "10px 12px", width: "130px" }}><Text as="span" variant="bodySm" fontWeight="semibold">GST Rate</Text></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const value = valueOf(row);
                        return (
                          <tr key={row.id} style={{ borderTop: "1px solid var(--p-color-border-secondary)" }}>
                            <td style={{ padding: "8px 12px" }}>
                              <Checkbox
                                label={`Select ${row.title}`}
                                labelHidden
                                checked={selected.includes(row.id)}
                                onChange={(checked) =>
                                  setSelected((prev) => (checked ? [...prev, row.id] : prev.filter((id) => id !== row.id)))
                                }
                              />
                            </td>
                            <td style={{ padding: "8px 12px" }}>
                              <Text as="span" variant="bodyMd">{row.title}</Text>
                            </td>
                            <td style={{ padding: "8px 12px" }}>
                              <TextField
                                label={`HSN code for ${row.title}`}
                                labelHidden
                                placeholder="Not set"
                                value={value.hsnCode}
                                onChange={(hsnCode) => updateRow(row, { hsnCode })}
                                autoComplete="off"
                              />
                            </td>
                            <td style={{ padding: "8px 12px" }}>
                              {value.hsnCode ? (
                                <Select
                                  label={`GST rate for ${row.title}`}
                                  labelHidden
                                  options={rateOptions(value.gstRate)}
                                  value={value.gstRate}
                                  onChange={(gstRate) => updateRow(row, { gstRate })}
                                />
                              ) : (
                                <Text as="span" variant="bodySm" tone="subdued">{fallbackLabel}</Text>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <Box padding="300">
                <InlineStack align="center">
                  <Pagination
                    hasPrevious={pageInfo.hasPreviousPage && changedRows.length === 0}
                    onPrevious={() => goTo({ before: pageInfo.startCursor })}
                    hasNext={pageInfo.hasNextPage && changedRows.length === 0}
                    onNext={() => goTo({ after: pageInfo.endCursor })}
                  />
                </InlineStack>
                {changedRows.length > 0 && (
                  <Box paddingBlockStart="200">
                    <Text as="p" alignment="center" variant="bodySm" tone="subdued">
                      Save your changes before moving to another page.
                    </Text>
                  </Box>
                )}
              </Box>
            </Card>
          </>
        )}
      </BlockStack>
    </Page>
  );
}
