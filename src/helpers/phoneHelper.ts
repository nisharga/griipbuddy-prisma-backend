/**
 * Bangladeshi mobile numbers. Customers type them in many ways
 * ("01712345678", "+8801712345678", "880 1712-345678"); these helpers turn
 * them into one format so the same person always matches.
 */

/** Any common format → "01XXXXXXXXX", or null if it isn't a Bangladeshi mobile number. */
export const toLocalPhone = (raw: unknown): string | null => {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("880")) digits = digits.slice(2); // 8801… → 01…
  if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`; // 17… → 017…
  return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
};

/** The ways the same number may be stored on older orders: 01…, +8801…, 8801… */
export const phoneVariants = (localPhone: string): string[] => {
  const withoutZero = localPhone.slice(1);
  return [localPhone, `+880${withoutZero}`, `880${withoutZero}`];
};
