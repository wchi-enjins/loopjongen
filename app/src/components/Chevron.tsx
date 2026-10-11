/** Dropdown arrow; points up when open. Same path as the select arrow in globals.css. */
export default function Chevron({ open = false }: { open?: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      style={{ marginLeft: 6, verticalAlign: "middle", transform: open ? "rotate(180deg)" : undefined }}
    >
      <path d="M3 6l5 5 5-5" />
    </svg>
  );
}
