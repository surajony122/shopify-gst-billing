import { Icon, Tooltip } from "@shopify/polaris";
import { InfoIcon } from "@shopify/polaris-icons";

/** Small info icon that explains a page when hovered or focused. */
export function InfoTip({ content }: { content: string }) {
  return (
    <Tooltip content={content} preferredPosition="below" width="wide">
      <span tabIndex={0} aria-label={content} style={{ display: "inline-flex", cursor: "help" }}>
        <Icon source={InfoIcon} tone="subdued" />
      </span>
    </Tooltip>
  );
}
