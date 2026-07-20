"use client";

import {
  API_PROVIDERS,
  PROVIDERS,
  type ApiProviderKey,
  type ProviderKey,
} from "@/lib/providers";

/**
 * Inline SVG brand icons on colored tiles.
 * Sources: SimpleIcons CC0 where paths are available.
 * Lesser-known brands fall back to bold letter monograms.
 */

// Real SVG paths from SimpleIcons (viewBox 0 0 24 24, fill)
const PATHS: Partial<Record<ProviderKey, string>> = {
  openai:
    "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",

  meta:
    "M6.915 2.962C3.667 2.962 0 6.826 0 12.38c0 3.466 1.616 5.627 3.962 5.627 1.808 0 3.13-.968 5.273-4.497.698-1.15 1.532-2.675 2.091-3.682l.942-1.656c.655-1.15 1.41-2.437 2.277-3.33C15.623 3.578 17.21 3 18.797 3c2.013 0 3.793.972 4.962 2.742 1.08 1.63 1.606 3.755 1.606 6.066 0 4.088-1.63 6.677-4.348 6.677-1.253 0-2.372-.55-3.352-1.64-.484-.54-.876-1.135-1.415-2.148a19.507 19.507 0 0 1-.568-1.148c-.28.518-.55 1.01-.8 1.467-1.357 2.477-2.605 3.77-4.58 3.77-1.204 0-2.26-.42-3.108-1.238-.97-.935-1.456-2.27-1.456-3.903 0-1.74.572-3.367 1.573-4.598.94-1.153 2.188-1.818 3.375-1.818 1.24 0 2.25.6 3.036 1.788.345.515.605 1.066.873 1.662.268-.596.527-1.148.873-1.662.786-1.188 1.796-1.788 3.036-1.788 1.187 0 2.434.665 3.375 1.818 1 1.23 1.572 2.858 1.572 4.598 0 1.633-.486 2.967-1.456 3.902-.847.82-1.904 1.238-3.108 1.238-1.974 0-3.222-1.292-4.58-3.77-.25-.456-.52-.95-.8-1.467-.167.41-.36.796-.568 1.148-.54 1.013-.93 1.608-1.415 2.147-.98 1.09-2.1 1.64-3.352 1.64C1.63 18.485 0 15.896 0 11.808c0-5.554 3.667-9.418 6.915-9.418 1.59 0 3.173.578 4.344 1.836.866.893 1.62 2.18 2.277 3.33l.942 1.655c.56 1.007 1.394 2.532 2.091 3.682 2.143 3.53 3.466 4.497 5.273 4.497 2.346 0 3.962-2.16 3.962-5.627 0-5.554-3.667-9.418-6.915-9.418-1.59 0-3.173.578-4.344 1.836a10.61 10.61 0 0 0-1.544 2.406 10.608 10.608 0 0 0-1.544-2.406C10.089 3.54 8.506 2.962 6.915 2.962z",

  qwen:
    "M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.25 17.25h-1.5v-3.75h-7.5v3.75h-1.5v-9a3.75 3.75 0 0 1 7.5 0v.75h-1.5v-.75a2.25 2.25 0 0 0-4.5 0v3.75h7.5z",

  gemini:
    "M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z",

  ollama:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z",
};

const API_PATHS: Partial<Record<ApiProviderKey, string>> = {
  groq:
    "M8 2C4.14 2 1 5.14 1 9v6c0 3.86 3.14 7 7 7h6c3.86 0 7-3.14 7-7V9c0-3.86-3.14-7-7-7H8zm6.5 13.5H8V8.5h6.5v7z",
  "ollama-cloud":
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11z",
};

// Monogram fallback for brands without a SimpleIcons path.
const LETTERS: Record<ProviderKey, string> = {
  openai:   "OA",
  deepseek: "DS",
  meta:     "ML",
  nvidia:   "NV",
  qwen:     "QW",
  gemini:   "GG",
  zhipu:    "ZP",
  minimax:  "MM",
  opencode: "OZ",
  ollama:   "OL",
  custom:   "CU",
};

const API_LETTERS: Record<ApiProviderKey, string> = {
  groq: "GQ",
  gemini: "GG",
  opencode: "OZ",
  "ollama-cloud": "OC",
  "ollama-local": "OL",
  custom: "CU",
};

export function ProviderIcon({
  provider,
  size = 28,
  className = "",
}: {
  provider: ProviderKey;
  size?: number;
  className?: string;
}) {
  const info = PROVIDERS[provider];
  return (
    <IconTile
      label={info.name}
      color={info.color}
      path={PATHS[provider]}
      letter={LETTERS[provider] ?? "?"}
      size={size}
      className={className}
    />
  );
}

export function ApiProviderIcon({
  provider,
  size = 18,
  className = "",
}: {
  provider: ApiProviderKey;
  size?: number;
  className?: string;
}) {
  const info = API_PROVIDERS[provider];
  return (
    <IconTile
      label={info.name}
      color={info.color}
      path={API_PATHS[provider]}
      letter={API_LETTERS[provider] ?? "?"}
      size={size}
      className={className}
    />
  );
}

function IconTile({
  label,
  color,
  path,
  letter,
  size,
  className,
}: {
  label: string;
  color: string;
  path?: string;
  letter: string;
  size: number;
  className: string;
}) {
  const borderRadius = Math.round(size * 0.26);
  const iconSize = Math.round(size * 0.62);
  const compact = letter.length > 1;
  const fontSize = Math.round(size * (compact ? 0.34 : 0.52));

  return (
    <span
      className={"inline-flex shrink-0 select-none items-center justify-center overflow-hidden " + className}
      style={{
        width: size,
        height: size,
        background: color,
        borderRadius,
      }}
      title={label}
      aria-label={label}
    >
      {path ? (
        <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill="white" aria-hidden>
          <path d={path} />
        </svg>
      ) : (
        <span
          style={{
            color: "#ffffff",
            fontSize,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: compact ? 0.2 : 0,
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          {letter}
        </span>
      )}
    </span>
  );
}
