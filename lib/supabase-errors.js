export function isMissingColumnError(error, column) {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  return error.code === "42703" || (message.includes(column.toLowerCase()) && message.includes("does not exist"));
}

export function isMissingCardFieldError(error) {
  return ["region", "status", "features_json", "is_featured", "display_order"]
    .some((column) => isMissingColumnError(error, column));
}
