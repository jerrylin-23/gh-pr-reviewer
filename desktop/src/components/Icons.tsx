/** Compact SVG icons. No emoji as primary UI language. */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 14, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    ...props,
  };
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="7" cy="7" r="3.5" />
      <path d="M10 10l3 3" />
    </svg>
  );
}

export function IconRepo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 2.5h8v11H4z" />
      <path d="M6 5h4M6 8h4M6 11h2" />
    </svg>
  );
}

export function IconPr(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="5" cy="4" r="1.5" />
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="11" cy="12" r="1.5" />
      <path d="M5 5.5v5M5 12h4.5a1.5 1.5 0 001.5-1.5V6" />
    </svg>
  );
}

export function IconSpark(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2l1.2 3.3L12.5 6.5 9.2 7.7 8 11 6.8 7.7 3.5 6.5l3.3-1.2z" />
      <path d="M12.5 10.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
    </svg>
  );
}

export function IconPanel(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="3" width="11" height="10" rx="1" />
      <path d="M10 3v10" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 2.5v1.5M8 12v1.5M2.5 8H4M12 8h1.5M4.2 4.2l1.1 1.1M10.7 10.7l1.1 1.1M11.8 4.2l-1.1 1.1M5.3 10.7l-1.1 1.1" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="5" width="7.5" height="7.5" rx="1" />
      <path d="M3.5 10.5V3.5h7" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13 8a5 5 0 11-1.4-3.4" />
      <path d="M13 3.5V7h-3.5" />
    </svg>
  );
}

export function IconChevron(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

export function IconCommand(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5.5 5.5H4a1.5 1.5 0 100 3h1.5V5.5zm0 0H10.5m0 0H12a1.5 1.5 0 110 3h-1.5V5.5zM5.5 10.5H4a1.5 1.5 0 110-3h1.5v3zm0 0H10.5m0 0H12a1.5 1.5 0 100-3h-1.5v3z" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconHistory(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.5l2 1.5" />
    </svg>
  );
}

export function IconFile(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 2.5h5l3 3v8h-8z" />
      <path d="M9.5 2.5v3h3" />
    </svg>
  );
}
