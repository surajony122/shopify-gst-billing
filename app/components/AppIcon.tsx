/** Draws an icon from the ONG sprite. The stroke follows the surrounding text color. */
export function AppIcon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <use href={`#ic-${name}`} />
    </svg>
  );
}
