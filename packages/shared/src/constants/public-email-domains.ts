export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "aol.com",
  "fastmail.com",
  "gmail.com",
  "googlemail.com",
  "hey.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mac.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "tutanota.com",
  "yahoo.com",
  "yandex.com",
  "ymail.com",
  "zoho.com",
])

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase())
}
