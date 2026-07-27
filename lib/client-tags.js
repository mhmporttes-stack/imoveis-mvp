export const DEFAULT_TAG_COLORS = [
  "#0D4F8B",
  "#1D4ED8",
  "#047857",
  "#B91C1C",
  "#7C3AED",
  "#334155",
  "#0F766E",
  "#BE123C"
];

export function normalizeTagName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeTagKey(value) {
  return normalizeTagName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function readableTagColor(color) {
  return /^#[0-9a-f]{6}$/i.test(String(color || "")) ? color : DEFAULT_TAG_COLORS[0];
}
