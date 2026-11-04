// Public page, linked from the App Store listing.
const COMPANY = {
  name: "WOM Media",
  address: "Berger Tower, Floor 19, Plot no C-001/A2, Sector 16B, Noida, Gautam Buddha Nagar, Uttar Pradesh 201301",
  email: "shreya.mehraworks@gmail.com",
};
const UPDATED = "5 November 2026";

export const meta = () => [{ title: "Terms of Service | WOM GST Invoice India" }];

export default function TermsOfService() {
  return (
    <main style={{ maxWidth: "760px", margin: "0 auto", padding: "40px 20px", fontFamily: "Helvetica, Arial, sans-serif", lineHeight: 1.6, color: "#1f2937" }}>
      <h1>Terms of Service</h1>
      <p>Last updated: {UPDATED}</p>
      <p>These terms are an agreement between {COMPANY.name}, {COMPANY.address} ("we") and the merchant who installs WOM GST Invoice India ("you"). By installing or using the app, you accept these terms.</p>

      <h2>What the app does</h2>
      <p>The app creates GST invoices from your Shopify orders and prepares GSTR-1 files for you or your CA to review. It does not file GST returns and does not generate IRNs or e-Way Bills.</p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Your GSTIN, business details, HSN codes, GST rates and app settings.</li>
        <li>Checking invoices and return files before you send or file them.</li>
        <li>Having a lawful basis to share your customers' data with us.</li>
        <li>Answering your customers' requests about their personal data.</li>
      </ul>

      <h2>Not tax advice</h2>
      <p>The app is a software tool and does not give tax or legal advice. Please confirm rates, invoices and filings with your CA.</p>

      <h2>Plans and billing</h2>
      <p>Plans and prices are shown in the app and on our App Store listing. Paid plans include a 7-day free trial and are charged by Shopify through its billing system. You can change or cancel your plan in the app. Shopify's billing terms apply to charges and refunds.</p>

      <h2>Customer data and privacy</h2>
      <p>We process customer names, email addresses, phone numbers, addresses and order details only to create invoices and return files for you. You remain responsible for that data as the merchant, and we process it on your instructions. We do not sell this data or use it for advertising. Our <a href="/privacy">Privacy Policy</a> has more detail.</p>
      <p>If we become aware of a security incident affecting your data, we will tell you without undue delay.</p>

      <h2>Keeping and deleting data</h2>
      <p>We keep data while the app is installed, because you need invoice records for your tax filings. Please download your invoices and return files before you uninstall. When Shopify sends us a request to erase a shop's data after you uninstall, we delete it as described in our Privacy Policy.</p>

      <h2>Availability</h2>
      <p>We work to keep the app available, but we do not promise it will be uninterrupted or free of errors.</p>

      <h2>Limit of liability</h2>
      <p>To the extent the law allows, we are not liable for indirect or consequential losses, or for tax, interest or penalties arising from invoices or filings you did not check. Our total liability is limited to the fees you paid us for the app in the 12 months before the claim.</p>

      <h2>Ending use</h2>
      <p>You can stop using the app at any time by uninstalling it. We may suspend access if you misuse the app or break these terms.</p>

      <h2>Changes</h2>
      <p>We may update these terms. We will post the new version here and change the date above.</p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of India. Courts in Noida, Uttar Pradesh have jurisdiction.</p>

      <h2>Contact</h2>
      <p>{COMPANY.name}, {COMPANY.address}. Email: {COMPANY.email}</p>
    </main>
  );
}
