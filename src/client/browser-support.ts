export function getBrowserWarning(userAgent = navigator.userAgent): string {
  if (!isFirefox(userAgent)) {
    return "";
  }

  return "Firefox is not supported. Use Chrome or Chromium.";
}

function isFirefox(userAgent: string): boolean {
  return /\b(Firefox|FxiOS)\//.test(userAgent);
}
