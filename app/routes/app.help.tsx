import { Page, Card, BlockStack, Banner, Text, List, Link, InlineGrid } from "@shopify/polaris";
import { InfoTip } from "../components/InfoTip";

const QUICK_LINKS = [
  ["Get started", "#get-started"],
  ["How invoices are created", "#invoices"],
  ["HSN codes", "#hsn"],
  ["Cancelled orders and refunds", "#credit-notes"],
  ["GSTR-1 report", "#gstr1"],
  ["Each page explained", "#pages"],
  ["What the app does not do", "#limits"],
  ["Common questions", "#faq"],
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} style={{ scrollMarginTop: "16px" }}>
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">{title}</Text>
          {children}
        </BlockStack>
      </Card>
    </div>
  );
}

export default function HelpPage() {
  return (
    <Page
      titleMetadata={<InfoTip content="Setup steps and answers about how the app works." />} title="Help & Docs" subtitle="How to set up and use WOM GST Invoice India">
      <BlockStack gap="400">
        <Banner tone="info">
          <p>This guide explains how the app works. It is not tax advice, so please confirm rates and filings with your CA.</p>
        </Banner>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingSm">On this page</Text>
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="100">
              {QUICK_LINKS.map(([label, href]) => (
                <Link key={href} url={href} removeUnderline>{label}</Link>
              ))}
            </InlineGrid>
          </BlockStack>
        </Card>

        <Section id="get-started" title="Get started">
          <List type="number">
            <List.Item><strong>GST Settings, Business Details:</strong> enter your GSTIN, legal name, PAN, address, phone and email.</List.Item>
            <List.Item><strong>GST Settings, Tax Rules:</strong> choose your GST scheme and how shipping is taxed, then set a default HSN code.</List.Item>
            <List.Item><strong>GST Settings, HSN Codes:</strong> add codes for your products or collections. Select several rows to edit them together.</List.Item>
            <List.Item><strong>Template Editor:</strong> choose a design and add your logo.</List.Item>
            <List.Item><strong>Rules & Routing:</strong> choose when invoices are created and how they are numbered.</List.Item>
            <List.Item><strong>GST Invoices:</strong> click Sync Past Orders to create invoices for your latest 50 orders.</List.Item>
          </List>
        </Section>

        <Section id="invoices" title="How invoices are created">
          <Text as="p">New invoices are created automatically, either when an order is fulfilled or when it is placed. You choose which in Rules & Routing.</Text>
          <List>
            <List.Item><strong>Same state as you:</strong> the invoice uses CGST + SGST.</List.Item>
            <List.Item><strong>Different state:</strong> the invoice uses IGST.</List.Item>
            <List.Item><strong>Buyer entered a GSTIN at checkout:</strong> it becomes a B2B invoice with its own number series.</List.Item>
            <List.Item><strong>Prices include tax in Shopify:</strong> tax is worked out from inside the price, so the invoice total matches what was paid.</List.Item>
            <List.Item><strong>Shipping:</strong> it is added as its own line and taxed using your Tax Rules setting.</List.Item>
          </List>
          <Text as="p"><strong>Regenerate Invoices</strong> rebuilds invoices from current Shopify data and keeps their numbers and dates. It skips invoices with credit notes. On live stores it also skips earlier months, because they may already be sent or filed.</Text>
        </Section>

        <Section id="hsn" title="HSN codes">
          <Text as="p">Each line on an invoice takes its HSN code and GST rate from the first of these that is set:</Text>
          <List type="number">
            <List.Item>The product's own code</List.Item>
            <List.Item>A collection the product belongs to</List.Item>
            <List.Item>The store default in Tax Rules</List.Item>
          </List>
          <Text as="p">If the apparel and footwear rule is on, HSN chapters 61, 62 and 64 use 5% up to ₹2,500 per piece and 18% above it. This replaces any rate you set for those codes.</Text>
          <Text as="p">999999 is only a placeholder and should not be used for filing.</Text>
        </Section>

        <Section id="credit-notes" title="Cancelled orders and refunds">
          <Text as="p">Once an invoice exists, the tax on it counts as payable. If money goes back to the customer, a <strong>credit note</strong> is the document that reduces that tax. Without one, you would keep paying GST on sales you refunded.</Text>
          <List>
            <List.Item><strong>Refund in Shopify:</strong> the app creates a credit note for the refunded amount automatically. There is nothing for you to do.</List.Item>
            <List.Item><strong>Order cancelled, invoice from this month:</strong> the invoice is marked Cancelled and left out of your totals and GSTR-1. If the refund was recorded first, a credit note reverses it instead, and the invoice shows that the order was cancelled.</List.Item>
            <List.Item><strong>Order cancelled, invoice from an earlier month:</strong> the invoice stays on record, because it may already be filed, and a credit note reverses it.</List.Item>
            <List.Item><strong>Order cancelled before an invoice exists:</strong> no invoice is created.</List.Item>
          </List>
          <Text as="p">Credit notes run in the background and are included in your GSTR-1 file. The app has no separate page for them.</Text>
        </Section>

        <Section id="gstr1" title="GSTR-1 report">
          <Text as="p"><strong>GSTR-1 is the return where a GST-registered business reports its sales</strong> to the government, usually every month or quarter. Your buyers' input tax credit depends on it. The report page prepares this data so that you or your CA don't have to build it by hand.</Text>
          <List>
            <List.Item><strong>Excel file:</strong> give this to your CA to review.</List.Item>
            <List.Item><strong>JSON file:</strong> check this in the official GST offline tool before uploading it to the GST portal.</List.Item>
          </List>
          <Text as="p">What is in the file:</Text>
          <List>
            <List.Item><strong>b2b:</strong> invoices to buyers with a GSTIN</List.Item>
            <List.Item><strong>b2cl:</strong> inter-state invoices to buyers without a GSTIN, above ₹1 lakh</List.Item>
            <List.Item><strong>b2cs:</strong> all other sales to buyers without a GSTIN, summarized by state and rate</List.Item>
            <List.Item><strong>cdnr / cdnur:</strong> credit notes</List.Item>
            <List.Item><strong>hsn:</strong> totals by HSN code</List.Item>
            <List.Item><strong>docs:</strong> the invoice and credit note numbers you issued</List.Item>
          </List>
          <Text as="p">The app does not file the return for you. Composition dealers file CMP-08 and GSTR-4 instead, so this export is turned off for them.</Text>
        </Section>

        <Section id="pages" title="Each page explained">
          <List>
            <List.Item><strong>Overview:</strong> a summary of invoices, sales and tax.</List.Item>
            <List.Item><strong>GST Invoices:</strong> search, view and download invoices, and open credit notes.</List.Item>
            <List.Item><strong>Template Editor:</strong> how your invoice looks.</List.Item>
            <List.Item><strong>Rules & Routing:</strong> when invoices are created, their numbering, and which design each order uses.</List.Item>
            <List.Item><strong>e-Invoicing:</strong> a list of invoices that may need an IRN or e-Way Bill.</List.Item>
            <List.Item><strong>GSTR-1 Reports:</strong> monthly totals and return files.</List.Item>
            <List.Item><strong>GST Settings:</strong> business details, tax rules and HSN codes.</List.Item>
            <List.Item><strong>Plan & Billing:</strong> your plan, monthly invoice use and 7-day free trial.</List.Item>
          </List>
        </Section>

        <Section id="limits" title="What the app does not do">
          <List>
            <List.Item>It does not generate IRNs or e-Way Bills. Create those on the government portals.</List.Item>
            <List.Item>It does not file GST returns.</List.Item>
            <List.Item>It does not email invoices to customers yet.</List.Item>
            <List.Item>It supports one GSTIN per store.</List.Item>
          </List>
        </Section>

        <Section id="faq" title="Common questions">
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h3" variant="headingSm">Why does an invoice say Retail Customer?</Text>
              <Text as="p">Either the order has no name on its address, or Shopify has not allowed the app to read customer data. A message appears on the page after syncing if access is the cause.</Text>
            </BlockStack>
            <BlockStack gap="100">
              <Text as="h3" variant="headingSm">Why does an invoice show ₹0?</Text>
              <Text as="p">The order total in Shopify is ₹0, usually because of a 100% discount.</Text>
            </BlockStack>
            <BlockStack gap="100">
              <Text as="h3" variant="headingSm">I changed an HSN code. Why did old invoices stay the same?</Text>
              <Text as="p">Existing invoices keep their saved values. Click Regenerate Invoices to rebuild the ones that are allowed to change.</Text>
            </BlockStack>
            <BlockStack gap="100">
              <Text as="h3" variant="headingSm">Why can't I lower the next invoice number?</Text>
              <Text as="p">Invoice numbers must not repeat, so the next number can only go up.</Text>
            </BlockStack>
          </BlockStack>
        </Section>
      </BlockStack>
    </Page>
  );
}
