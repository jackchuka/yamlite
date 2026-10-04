export const q = (id: string): string => `"${id.replaceAll('"', '""')}"`;
