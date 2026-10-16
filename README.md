# GST Invoicing & Compliance App for Shopify India 🇮🇳

A complete, production-grade **Goods and Services Tax (GST)** Invoicing, e-Invoicing (IRN), e-Way Bill, and GSTR-1 Filing application built for Indian Shopify merchants.

---

## 🌟 Key Features

1. **Rule 46 Compliant Tax Invoices:**
   * Automated Place of Supply (POS) detection.
   * State-level tax split: **Intra-state (CGST 50% + SGST 50%)** vs. **Inter-state (IGST 100%)**.
   * Section 170 Rupee Rounding engine.
   * Vector-rendered PDF generation with bank details, UPI QR code, and digital signatures.
2. **Shopify Checkout Extensibility:**
   * Modern B2B GSTIN collection block inside Shopify Checkout.
   * Live 15-character GSTIN regex & checksum validation.
   * Saves customer GSTIN into `Order.customAttributes`.
3. **Credit Notes (Section 34):**
   * Automatic generation of Credit Notes upon order refunds/cancellations.
4. **HSN / SAC Code Manager:**
   * Product and variant-level HSN mapping.
   * Bulk default application and tax slab controls (0%, 5%, 12%, 18%, 28%).
5. **e-Invoicing (IRN) & e-Way Bills:**
   * Ready for merchants with turnover > ₹5 Crores.
   * IRN hash and dynamic signed QR code generation.
6. **GSTR-1 CA-Ready Reporting:**
   * 1-Click Multi-Sheet Excel (`b2b`, `b2cl`, `b2cs`, `hsn`, `docs`).
   * 1-Click GSTR-1 JSON for direct upload to the official GST offline tool.
   * Tally Prime XML export.

---

## 📂 Project Architecture

```
├── app/
│   ├── routes/
│   │   ├── app._index.tsx               # Page 1: Dashboard & KPIs
│   │   ├── app.invoices._index.tsx      # Page 2: Tax Invoices & Orders list
│   │   ├── app.credit-notes.tsx         # Page 3: Credit Notes (Section 34)
│   │   ├── app.hsn-catalog.tsx          # Page 4: HSN & Tax Slab Catalog
│   │   ├── app.e-invoicing.tsx          # Page 5: e-Invoicing (IRN) & e-Way Bills
│   │   ├── app.reports.tsx              # Page 6: GST Filing Reports & GSTR-1
│   │   ├── app.settings.tsx             # Page 7: Settings & Multi-GSTIN
│   │   ├── api.invoices.$id.pdf.ts      # Streaming Vector PDF generator
│   │   ├── api.reports.gstr1.ts         # Streaming GSTR-1 Excel & JSON
│   │   ├── webhooks.orders.create.ts    # Webhook for automatic invoice creation
│   │   └── webhooks.refunds.create.ts   # Webhook for automatic credit note creation
│   ├── services/
│   │   ├── gst-engine.server.ts         # Indian GST calculation & State POS logic
│   │   ├── pdf-generator.server.ts      # Rule 46 PDF generator (jspdf + autotable)
│   │   └── gstr1-exporter.server.ts     # Multi-sheet Excel generator (xlsx)
│   ├── db.server.ts                     # Prisma Client singleton
│   ├── shopify.server.ts                # Shopify App Remix configuration
│   └── root.tsx                         # Root layout with Shopify Polaris
├── extensions/
│   └── gst-checkout-extension/          # Storefront Checkout UI Extension (GSTIN collector)
├── prisma/
│   └── schema.prisma                    # PostgreSQL schema (Stores, Invoices, HSNs, etc.)
├── render.yaml                          # Render.com Infrastructure-as-Code Blueprint
├── Dockerfile                           # Containerized production runner
└── shopify.app.toml                     # Shopify CLI manifest & scopes
```

---

## 🚀 Deploying to Render.com

This repository includes a `render.yaml` blueprint that provisions:
1. **Node.js Web Service**
2. **Managed PostgreSQL Database**

### Steps to Deploy:
1. Push this repository to your GitHub account:
   ```bash
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git branch -M main
   git push -u origin main
   ```
2. Log in to [Render.com](https://render.com).
3. Click **New +** → **Blueprint**.
4. Select your GitHub repository.
5. Set your environment variables in the Render dashboard:
   * `SHOPIFY_API_KEY`: From your Shopify Partner App.
   * `SHOPIFY_API_SECRET`: From your Shopify Partner App.
   * `APP_URL`: Your Render service URL (e.g., `https://shopify-gst-billing.onrender.com`).
6. Click **Apply** — Render will build the app, run Prisma migrations, and launch your service!

---

## 🛠️ Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run database migration:
   ```bash
   npx prisma generate
   ```
3. Start Shopify local tunnel:
   ```bash
   shopify app dev
   ```
