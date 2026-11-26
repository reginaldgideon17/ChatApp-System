import { Link } from "react-router-dom";

const TRAILING_PUNCTUATION = /[.,!?;:]+$/;

function parseMessageUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export default function MessageText({ children }) {
  const text = String(children ?? "");
  const parts = [];
  let lastIndex = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const rawUrl = match[0];
    const punctuation = rawUrl.match(TRAILING_PUNCTUATION)?.[0] || "";
    const linkText = rawUrl.slice(0, rawUrl.length - punctuation.length);

    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));

    const url = parseMessageUrl(linkText);
    if (!url) {
      parts.push(linkText);
    } else if (url.origin === window.location.origin) {
      parts.push(
        <Link key={`${match.index}-${linkText}`} to={`${url.pathname}${url.search}${url.hash}`}>
          {linkText}
        </Link>
      );
    } else {
      parts.push(
        <a key={`${match.index}-${linkText}`} href={url.href} target="_blank" rel="noopener noreferrer">
          {linkText}
        </a>
      );
    }

    if (punctuation) parts.push(punctuation);
    lastIndex = match.index + rawUrl.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
