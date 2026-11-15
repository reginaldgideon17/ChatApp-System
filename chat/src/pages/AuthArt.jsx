// Decorative picture for the left side of the login/sign-up card.
// It's drawn with plain SVG shapes (no image files to load).
export default function AuthArt() {
  return (
    <svg className="auth-art-svg" viewBox="0 0 400 360" role="img" aria-label="Chat bubbles floating around a phone">
      <defs>
        <linearGradient id="authBubbleA" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9a4d" />
          <stop offset="1" stopColor="#ff5a1f" />
        </linearGradient>
        <linearGradient id="authBubbleB" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="1" stopColor="#14b8a6" />
        </linearGradient>
        <linearGradient id="authPhone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2433" />
          <stop offset="1" stopColor="#17131d" />
        </linearGradient>
      </defs>

      <circle cx="200" cy="190" r="140" fill="#ffffff" fillOpacity="0.05" />
      <circle cx="200" cy="190" r="100" fill="#ffffff" fillOpacity="0.05" />

      {/* phone */}
      <rect x="140" y="60" width="120" height="240" rx="22" fill="url(#authPhone)" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="2" />
      <rect x="187" y="70" width="26" height="5" rx="2.5" fill="#ffffff" fillOpacity="0.25" />
      <rect x="154" y="100" width="70" height="26" rx="13" fill="#ffffff" fillOpacity="0.14" />
      <rect x="176" y="136" width="70" height="26" rx="13" fill="url(#authBubbleA)" />
      <rect x="154" y="172" width="54" height="26" rx="13" fill="#ffffff" fillOpacity="0.14" />
      <rect x="176" y="208" width="70" height="26" rx="13" fill="url(#authBubbleA)" />
      <rect x="154" y="248" width="92" height="28" rx="14" fill="#ffffff" fillOpacity="0.1" />
      <circle cx="166" cy="262" r="3" fill="#ffffff" fillOpacity="0.5" />
      <circle cx="177" cy="262" r="3" fill="#ffffff" fillOpacity="0.35" />
      <circle cx="188" cy="262" r="3" fill="#ffffff" fillOpacity="0.2" />

      {/* floating bubbles */}
      <g>
        <rect x="40" y="90" width="84" height="44" rx="22" fill="url(#authBubbleB)" />
        <path d="M70 134 L62 150 L86 134 Z" fill="#14b8a6" />
        <circle cx="66" cy="112" r="4" fill="#ffffff" />
        <circle cx="82" cy="112" r="4" fill="#ffffff" fillOpacity="0.8" />
        <circle cx="98" cy="112" r="4" fill="#ffffff" fillOpacity="0.6" />
      </g>
      <g>
        <rect x="282" y="150" width="86" height="46" rx="23" fill="url(#authBubbleA)" />
        <path d="M340 196 L350 212 L322 196 Z" fill="#ff5a1f" />
        <path d="M312 173 l8 8 l14 -16" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g>
        <circle cx="318" cy="84" r="20" fill="#ffffff" fillOpacity="0.14" />
        <path d="M318 94 C306 86 304 78 311 74 C315 72 318 75 318 77 C318 75 321 72 325 74 C332 78 330 86 318 94 Z" fill="#ff7a45" />
      </g>
      <circle cx="70" cy="250" r="9" fill="#ffffff" fillOpacity="0.2" />
      <circle cx="96" cy="276" r="5" fill="#5eead4" fillOpacity="0.7" />
      <circle cx="340" cy="280" r="7" fill="#ffffff" fillOpacity="0.18" />
    </svg>
  );
}