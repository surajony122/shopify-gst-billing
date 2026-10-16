import React, { useState } from "react";
import {
  reactExtension,
  useApplyAttributeChange,
  useAttributes,
  BlockStack,
  Checkbox,
  TextField,
  Text,
  Banner,
} from "@shopify/ui-extensions-react/checkout";

export default reactExtension(
  "purchase.checkout.shipping-address.render-after",
  () => <Extension />
);

function Extension() {
  const applyAttributeChange = useApplyAttributeChange();
  const attributes = useAttributes();

  const existingGstin = attributes.find((a) => a.key === "gstin")?.value || "";
  const existingCompany = attributes.find((a) => a.key === "company_name")?.value || "";

  const [isB2B, setIsB2B] = useState(Boolean(existingGstin));
  const [gstin, setGstin] = useState(existingGstin);
  const [companyName, setCompanyName] = useState(existingCompany);
  const [error, setError] = useState<string | null>(null);

  const validateGSTIN = (val: string) => {
    const clean = val.trim().toUpperCase();
    const regex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!regex.test(clean)) {
      return "Please enter a valid 15-digit GSTIN (e.g. 27AABCU9603R1ZM)";
    }
    return null;
  };

  const handleGstinChange = async (value: string) => {
    const clean = value.toUpperCase();
    setGstin(clean);

    if (clean.length === 15) {
      const err = validateGSTIN(clean);
      setError(err);
      if (!err) {
        await applyAttributeChange({
          type: "updateAttribute",
          key: "gstin",
          value: clean,
        });
      }
    } else {
      setError(clean.length > 0 ? "GSTIN must be exactly 15 characters" : null);
    }
  };

  const handleCompanyChange = async (value: string) => {
    setCompanyName(value);
    await applyAttributeChange({
      type: "updateAttribute",
      key: "company_name",
      value,
    });
  };

  const handleCheckboxChange = async (checked: boolean) => {
    setIsB2B(checked);
    if (!checked) {
      setGstin("");
      setCompanyName("");
      setError(null);
      await applyAttributeChange({
        type: "updateAttribute",
        key: "gstin",
        value: "",
      });
      await applyAttributeChange({
        type: "updateAttribute",
        key: "company_name",
        value: "",
      });
    }
  };

  return (
    <BlockStack spacing="tight">
      <Checkbox
        checked={isB2B}
        onChange={handleCheckboxChange}
      >
        I am purchasing for a business (Claim GST Input Tax Credit)
      </Checkbox>

      {isB2B && (
        <BlockStack spacing="tight">
          <TextField
            label="GSTIN (15 Digits)"
            value={gstin}
            onChange={handleGstinChange}
          />
          {error && <Text appearance="critical">{error}</Text>}
          {!error && gstin.length === 15 && (
            <Banner status="success">
              ✓ Valid GSTIN. GST Invoice will be issued for ITC claim.
            </Banner>
          )}

          <TextField
            label="Registered Company / Legal Name"
            value={companyName}
            onChange={handleCompanyChange}
          />
        </BlockStack>
      )}
    </BlockStack>
  );
}
