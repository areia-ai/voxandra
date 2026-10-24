export function normalizePhoneE164(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed.startsWith("+")) return "";

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

export function isE164Phone(value: string | null | undefined) {
  return /^\+[1-9]\d{7,14}$/.test(normalizePhoneE164(value));
}

export function phoneNumbersMatch(
  left: string | null | undefined,
  right: string | null | undefined
) {
  const normalizedLeft = normalizePhoneE164(left);
  const normalizedRight = normalizePhoneE164(right);
  if (normalizedLeft && normalizedRight) return normalizedLeft === normalizedRight;
  return (left?.trim() ?? "") !== "" && left?.trim() === right?.trim();
}
