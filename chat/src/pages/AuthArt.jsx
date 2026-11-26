export default function AuthArt() {
  return (
    <svg
      className="auth-art-svg"
      viewBox="0 0 520 1000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="auth-night" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#291a31" />
          <stop offset="0.55" stopColor="#140f1b" />
          <stop offset="1" stopColor="#09080e" />
        </linearGradient>
        <linearGradient id="auth-wall" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#382940" />
          <stop offset="0.48" stopColor="#211827" />
          <stop offset="1" stopColor="#100e16" />
        </linearGradient>
        <linearGradient id="auth-light" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#14b8a6" stopOpacity="0" />
          <stop offset="0.42" stopColor="#ff6a28" />
          <stop offset="0.72" stopColor="#d1349a" />
          <stop offset="1" stopColor="#14b8a6" stopOpacity="0.15" />
        </linearGradient>
        <radialGradient id="auth-glow" cx="48%" cy="62%" r="52%">
          <stop offset="0" stopColor="#ff6a28" stopOpacity="0.3" />
          <stop offset="0.58" stopColor="#d1349a" stopOpacity="0.12" />
          <stop offset="1" stopColor="#d1349a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="auth-teal-glow" cx="22%" cy="43%" r="38%">
          <stop offset="0" stopColor="#14b8a6" stopOpacity="0.17" />
          <stop offset="1" stopColor="#14b8a6" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="520" height="1000" fill="url(#auth-night)" />
      <rect width="520" height="1000" fill="url(#auth-glow)" />
      <rect width="520" height="1000" fill="url(#auth-teal-glow)" />
      <path d="M0 0h520v220L308 310 0 176Z" fill="#060608" />
      <path d="M0 176 308 310v434L0 610Z" fill="url(#auth-wall)" />
      <path d="M308 310 520 220v488l-212 36Z" fill="#18121e" />
      <path d="M160 256 370 345v330l-210-84Z" fill="#070709" />
      <path d="M174 274 356 351v297l-182-71Z" fill="#100c16" stroke="#8654a0" strokeOpacity="0.48" strokeWidth="2" />
      <path d="M0 613 308 744l212-36v292H0Z" fill="#08080a" />
      <path d="m0 624 308 128 212-36" fill="none" stroke="url(#auth-light)" strokeWidth="5" />
      <path d="m0 704 308 127 212-37" fill="none" stroke="#ff6a28" strokeOpacity="0.32" strokeWidth="2" />
      <path d="m0 788 308 126 212-38" fill="none" stroke="#14b8a6" strokeOpacity="0.24" strokeWidth="2" />
      <path d="M0 868 308 990h212" fill="none" stroke="#d1349a" strokeOpacity="0.2" strokeWidth="2" />

      <path d="M24 414 130 461v194L24 612Z" fill="#050506" />
      <path d="m24 412 106 48" fill="none" stroke="#ff8a52" strokeOpacity="0.85" strokeWidth="4" />
      <path d="m24 613 106 44M24 638l106 44M24 663l106 44" fill="none" stroke="#604168" strokeWidth="4" />
      <path d="M396 0v306M411 0v300" stroke="#fff1d8" strokeOpacity="0.035" strokeWidth="2" />

      <g fill="none" stroke="#24534f" strokeLinecap="round">
        <path d="M82 705c24-66 37-139 34-221m-2 106c-23-15-34-31-40-54m42-10c20-18 29-34 34-56m-43 88c-21-9-33-23-44-44m47 110c18-18 34-26 52-31" strokeWidth="5" />
        <path d="M71 562c-19-2-29-12-34-27m89-23c17-4 28-14 34-29m-65 99c-17-2-28-9-39-21m79 37c16-7 27-9 40-6" strokeWidth="3" />
      </g>
      <g fill="#34766d" fillOpacity="0.55">
        <ellipse cx="37" cy="535" rx="19" ry="7" transform="rotate(32 37 535)" />
        <ellipse cx="159" cy="510" rx="18" ry="7" transform="rotate(-48 159 510)" />
        <ellipse cx="34" cy="590" rx="19" ry="7" transform="rotate(36 34 590)" />
        <ellipse cx="178" cy="638" rx="20" ry="7" transform="rotate(-18 178 638)" />
        <ellipse cx="67" cy="620" rx="18" ry="7" transform="rotate(28 67 620)" />
      </g>
      <rect width="520" height="1000" fill="#09080e" fillOpacity="0.1" />
    </svg>
  );
}
