/**
 * Normalizes a phone number to the format stored in users.phone: "+998901234567".
 * Accepts "+998 90 123-45-67", "998901234567" and the local 9-digit form "901234567".
 * Returns null if the result is not a valid international number.
 */
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 9) {
    digits = `998${digits}`; // local Uzbek number without country code
  }
  if (digits.length < 9 || digits.length > 15) return null;
  return `+${digits}`;
}
