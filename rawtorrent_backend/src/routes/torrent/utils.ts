export const normalizeSelectedIndices = (value: unknown): number[] | undefined => {
  const parseArray = (source: unknown[]) => {
    const normalized = source
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0);
    return normalized.length > 0 ? normalized : undefined;
  };

  if (Array.isArray(value)) {
    return parseArray(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parseArray(parsed);
      }
    } catch {
      const split = value.split(",").map((part) => part.trim()).filter(Boolean);
      return parseArray(split);
    }
  }

  return undefined;
};
