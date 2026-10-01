const MAX_SAMPLE = 5;

// the first few items of a list for a message
export const sample = (items: string[]): string =>
  items.length > MAX_SAMPLE ? `${items.slice(0, MAX_SAMPLE).join(", ")}, …` : items.join(", ");
