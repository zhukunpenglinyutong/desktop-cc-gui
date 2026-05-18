export function formatUpdatedAt(
  updatedAt: number | null | undefined,
  locale: string,
): string {
  if (
    updatedAt === null ||
    updatedAt === undefined ||
    !Number.isFinite(updatedAt) ||
    updatedAt <= 0
  ) {
    return "--";
  }
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
