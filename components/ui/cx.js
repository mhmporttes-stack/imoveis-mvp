// Junta classes condicionais: cx("a", cond && "b", undefined) → "a b".
export function cx(...values) {
  return values.filter(Boolean).join(" ");
}
