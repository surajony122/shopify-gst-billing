import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { NavLink, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getPlanUsage } from "../services/plans.server";
import { AppIcon } from "../components/AppIcon";
import { ICON_SPRITE } from "../components/icon-sprite";

const NAV_GROUPS = [
  { label: "Home", links: [{ to: "/app", label: "Overview", icon: "grid", end: true }] },
  {
    label: "Invoicing",
    links: [
      { to: "/app/invoices", label: "GST Invoices", icon: "receipt" },
      { to: "/app/e-invoicing", label: "e-Invoicing", icon: "file-text" },
      { to: "/app/reports", label: "GSTR-1 Report", icon: "bar-chart" },
    ],
  },
  {
    label: "Store setup",
    links: [
      { to: "/app/templates", label: "Template Editor", icon: "edit" },
      { to: "/app/rules", label: "Rules & Routing", icon: "sliders" },
      { to: "/app/settings", label: "GST Settings", icon: "gear" },
      { to: "/app/billing", label: "Plan & Billing", icon: "credit-card" },
    ],
  },
  { label: "Support", links: [{ to: "/app/help", label: "Help & Docs", icon: "help-circle" }] },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Older sessions hold a non-expiring token, which Shopify refuses with a 403 for newer
  // public apps. Removing the row makes the next request exchange for an expiring token.
  if (!session.isOnline && !session.refreshToken) {
    console.info(`Replacing non-expiring offline token for ${session.shop}`);
    await prisma.session.deleteMany({ where: { id: session.id } });
  }

  return json({ apiKey: process.env.SHOPIFY_API_KEY || "", shop: session.shop, usage: await getPlanUsage(session.shop) });
};

export default function App() {
  const { apiKey, shop, usage } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey} i18n={polarisTranslations}>
      <svg style={{ display: "none" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON_SPRITE }} />
      <div className="ong-shell">
        <nav className="ong-side" aria-label="App menu">
          <div className="ong-brand">
            <span className="ong-brand-mark"><AppIcon name="receipt" size={20} /></span>
            <div>
              <div className="ong-brand-name">WOM GST Invoice India</div>
              <div className="ong-brand-sub">{shop.replace(".myshopify.com", "")}</div>
            </div>
          </div>
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="ong-group">{group.label}</div>
              {group.links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={"end" in link}
                  className={({ isActive }) => `ong-link${isActive ? " active" : ""}`}
                >
                  <AppIcon name={link.icon} />
                  {link.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <main className="ong-main">
          {usage.limit !== null && usage.used >= usage.limit * 0.8 && (
            <div className="ong-limit">
              <AppIcon name="alert-triangle" size={16} />
              {usage.used > usage.limit
                ? `You've passed this month's ${usage.limit} invoice limit. Newer invoices can't be downloaded until you upgrade.`
                : `You've used ${usage.used} of ${usage.limit} invoices this month.`}
              <NavLink to="/app/billing">View plans</NavLink>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
