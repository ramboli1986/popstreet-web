export const TRANSIT_LINE_OPTIONS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "J",
  "L",
  "M",
  "N",
  "Q",
  "R",
  "S",
  "W",
  "Z",
  "PATH"
] as const;

export type TransitLineName = (typeof TRANSIT_LINE_OPTIONS)[number];

const transitLineOrder = new Map<string, number>(TRANSIT_LINE_OPTIONS.map((line, index) => [line, index]));

export function normalizeTransitLine(value: string | null | undefined): TransitLineName | null {
  if (!value) {
    return null;
  }

  const upperValue = value.trim().toUpperCase();
  if (!upperValue) {
    return null;
  }

  if (upperValue.includes("PATH")) {
    return "PATH";
  }

  const directMatch = transitLineOrder.has(upperValue) ? upperValue : null;
  if (directMatch) {
    return directMatch as TransitLineName;
  }

  const tokenMatch = upperValue
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .find((token) => transitLineOrder.has(token));

  return tokenMatch ? (tokenMatch as TransitLineName) : null;
}

export function normalizeTransitLines(values: readonly (string | null | undefined)[]): TransitLineName[] {
  const uniqueLines = new Set<TransitLineName>();

  values.forEach((value) => {
    const line = normalizeTransitLine(value);
    if (line) {
      uniqueLines.add(line);
    }
  });

  return [...uniqueLines].sort((first, second) => transitLineOrder.get(first)! - transitLineOrder.get(second)!);
}

export function toggleTransitLine(values: readonly string[], line: string): TransitLineName[] {
  const normalizedValues = normalizeTransitLines(values);
  const normalizedLine = normalizeTransitLine(line);

  if (!normalizedLine) {
    return normalizedValues;
  }

  if (normalizedValues.includes(normalizedLine)) {
    return normalizedValues.filter((value) => value !== normalizedLine);
  }

  return normalizeTransitLines([...normalizedValues, normalizedLine]);
}
