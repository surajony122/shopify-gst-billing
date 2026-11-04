import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function Extension() {
  const attributes = shopify.attributes.value;
  const existingGstin = attributes?.find((a) => a.key === "gstin")?.value || "";
  const existingCompany = attributes?.find((a) => a.key === "company_name")?.value || "";

  const [isB2B, setIsB2B] = useState(Boolean(existingGstin));
  const [gstin, setGstin] = useState(existingGstin);
  const [companyName, setCompanyName] = useState(existingCompany);

  // Some checkouts, such as express wallets, do not allow attributes to be changed.
  if (!shopify.instructions.value.attributes.canUpdateAttributes) {
    return null;
  }

  const saveAttribute = (key: string, value: string) =>
    shopify.applyAttributeChange({ type: "updateAttribute", key, value });

  const isValid = GSTIN_REGEX.test(gstin);
  let error: string | undefined;
  if (gstin.length > 0 && gstin.length !== 15) {
    error = "GSTIN must be exactly 15 characters";
  } else if (gstin.length === 15 && !isValid) {
    error = "Please enter a valid 15-digit GSTIN (e.g. 27AABCU9603R1ZM)";
  }

  const handleGstinInput = async (value: string) => {
    const clean = value.trim().toUpperCase();
    setGstin(clean);
    // An edited GSTIN must not leave the earlier valid one on the order.
    await saveAttribute("gstin", GSTIN_REGEX.test(clean) ? clean : "");
  };

  const handleCompanyChange = async (value: string) => {
    setCompanyName(value);
    await saveAttribute("company_name", value);
  };

  const handleCheckboxChange = async (checked: boolean) => {
    setIsB2B(checked);
    if (!checked) {
      setGstin("");
      setCompanyName("");
      await saveAttribute("gstin", "");
      await saveAttribute("company_name", "");
    }
  };

  return (
    <s-stack gap="base">
      <s-checkbox
        label="I am purchasing for a business (Claim GST Input Tax Credit)"
        checked={isB2B}
        onChange={(event) => handleCheckboxChange((event.currentTarget as HTMLInputElement).checked)}
      />

      {isB2B && (
        <s-stack gap="base">
          <s-text-field
            label="GSTIN (15 Digits)"
            value={gstin}
            error={error}
            onInput={(event) => handleGstinInput((event.currentTarget as HTMLInputElement).value)}
          />
          {isValid && (
            <s-banner tone="success">
              Valid GSTIN. GST Invoice will be issued for ITC claim.
            </s-banner>
          )}

          <s-text-field
            label="Registered Company / Legal Name"
            value={companyName}
            onChange={(event) => handleCompanyChange((event.currentTarget as HTMLInputElement).value)}
          />
        </s-stack>
      )}
    </s-stack>
  );
}
