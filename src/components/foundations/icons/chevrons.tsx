import type { SVGProps } from "react";

/**
 * Custom chevron glyphs drawn as vectors in the Board UI Figma file (they are
 * not Remix icons). Paths are copied 1:1 from the Figma export.
 *
 * All icons render `currentColor` and size via Tailwind `size-*` utilities,
 * exactly like the Remix icon components.
 */

type IconProps = SVGProps<SVGSVGElement>;

/** 16×16 rounded 2px-stroke chevron. Select triggers, disclosure affordances. */
export function ChevronDownSmall(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M4 7L7.29289 10.2929C7.68342 10.6834 8.31658 10.6834 8.70711 10.2929L12 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
