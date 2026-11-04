// Public page, linked from the App Store listing.
const COMPANY = {
  name: "WOM Media",
  address: "Berger Tower, Floor 19, Plot no C-001/A2, Sector 16B, Noida, Gautam Buddha Nagar, Uttar Pradesh 201301",
  email: "shreya.mehraworks@gmail.com",
};
const UPDATED = "4 November 2026";

export const meta = () => [{ title: "Privacy Policy | WOM GST Invoice India" }];

export default function PrivacyPolicy() {
  return (
    <main style={{ maxWidth: "760px", margin: "0 auto", padding: "40px 20px", fontFamily: "Helvetica, Arial, sans-serif", lineHeight: 1.6, color: "#2a2833" }}>
      <h1>Privacy Policy</h1>
      <p>WOM GST Invoice India is a Shopify app provided by {COMPANY.name}. This policy explains what the app does with data from merchants and their customers. Last updated: {UPDATED}.</p>

      <h2>Data we collect</h2>
      <p>When a merchant installs the app, we receive data from Shopify and from the merchant:</p>
      <ul>
        <li><strong>Store details:</strong> store address on Shopify, and the business details the merchant enters, such as GSTIN, PAN, address, phone, email and bank or UPI details.</li>
        <li><strong>Order details:</strong> order numbers, dates, products, prices, discounts, shipping, taxes, refunds and payment method names.</li>
        <li><strong>Customer details on orders:</strong> name, email, phone, shipping and billing addresses, and any GSTIN or company name entered at checkout.</li>
        <li><strong>Product details:</strong> product and collection names, and the HSN codes and GST rates the merchant sets.</li>
        <li><strong>Uploaded images:</strong> a logo and a signature or seal, if the merchant adds them.</li>
      </ul>

      <h2>How we use it</h2>
      <p>We use this data only to run the app: to create GST invoices and credit notes, calculate tax, and prepare GSTR-1 files for the merchant. We do not sell this data or use it for advertising.</p>

      <h2>Who can see it</h2>
      <p>Each merchant can see their own store's data in the app. Data is stored with our hosting provider, Render, and billing is handled by Shopify. We may also disclose data where the law requires it.</p>

      <h2>How long we keep it</h2>
      <p>We keep data while the app is installed, because merchants need invoice records for their tax filings. After a merchant uninstalls the app, Shopify sends us a deletion request about 48 hours later, and we then delete that store's data. Merchants should download any records they must keep before uninstalling.</p>

      <h2>Customer requests</h2>
      <p>Customers should contact the store they bought from. When Shopify sends us a merchant's customer deletion request, we remove that customer's contact details from invoices. We keep the invoice itself, and the business name and GSTIN on B2B invoices, because tax records must be retained.</p>

      <h2>Contact</h2>
      <p>{COMPANY.name}, {COMPANY.address}. Email: {COMPANY.email}</p>
    </main>
  );
}
