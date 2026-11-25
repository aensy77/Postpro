import React from 'react';

export const APP_INFO = {
  name: 'PostPro',
  fullName: 'PostPro Studio',
  version: '1.1',
  creator: 'Aensy77',
} as const;

interface PostProLogoProps {
  size?: number;
  className?: string;
}

export const PostProLogo: React.FC<PostProLogoProps> = ({ size = 24, className = '' }) => {
  const uid = React.useId().replace(/:/g, '');
  const gradStroke = `pp-stroke-${uid}`;
  const gradFill = `pp-fill-${uid}`;
  const gradPrism = `pp-prism-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="PostPro Logo"
    >
      <defs>
        <linearGradient id={gradStroke} x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00f0ff" />
          <stop offset="52%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#ff2a85" />
        </linearGradient>
        <linearGradient id={gradFill} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#07090f" />
        </linearGradient>
        <linearGradient id={gradPrism} x1="24" y1="18" x2="48" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00f0ff" />
          <stop offset="100%" stopColor="#00ff9d" />
        </linearGradient>
      </defs>

      {/* Studio Obsidian Squircle Base */}
      <rect x="3" y="3" width="58" height="58" rx="14" fill={`url(#${gradFill})`} />
      <rect
        x="3.75"
        y="3.75"
        width="56.5"
        height="56.5"
        rx="13.25"
        stroke={`url(#${gradStroke})`}
        strokeWidth="2"
      />

      {/* BBCode Left Bracket Spine [ */}
      <path
        d="M19 14H14.5C13.3954 14 12.5 14.8954 12.5 16V48C12.5 49.1046 13.3954 50 14.5 50H19"
        stroke="#00f0ff"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* PostPro Architectural "P" Stem + Bowl */}
      <path
        d="M22 48V16H36.5C43.4036 16 48.5 20.5 48.5 26.8C48.5 33.1 43.4036 37.6 36.5 37.6H27.5"
        stroke="#f8fafc"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Media Play / Pro Prism Inside the "P" Bowl */}
      <path
        d="M31 22.2L40.2 26.8L31 31.4V22.2Z"
        fill={`url(#${gradPrism})`}
      />

      {/* Right Closing BBCode Bracket Accent ] */}
      <path
        d="M46 42H49.5C50.6046 42 51.5 42.8954 51.5 44V48C51.5 49.1046 50.6046 50 49.5 50H46"
        stroke="#ff2a85"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Pro Diagonal Baseline Accent */}
      <line
        x1="28.5"
        y1="46.5"
        x2="41.5"
        y2="46.5"
        stroke="#ff2a85"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
};
