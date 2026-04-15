import type { CSSProperties } from "react";

type SharedSessionIconProps = {
  size?: number;
  className?: string;
  style?: CSSProperties;
};

export function SharedSessionIcon({
  size = 14,
  className,
  style,
}: SharedSessionIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={{ width: size, height: size, flexShrink: 0, ...style }}
      aria-hidden
    >
      <circle cx="6.7" cy="8.2" r="2.1" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.3" cy="8.2" r="2.1" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="16.5" r="2.1" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8.7 9.6 10.8 11m4.5-1.4L13.2 11m-1.2 3v.9"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11.9" r="1.35" fill="currentColor" />
    </svg>
  );
}
