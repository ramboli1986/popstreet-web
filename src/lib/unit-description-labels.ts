export type UnitDescriptionLabelOption = {
  value: string;
  category: "floor" | "view" | "layout" | "feature";
};

export type UnitDescriptionLabelGroup = {
  title: string;
  options: UnitDescriptionLabelOption[];
};

export const unitDescriptionLabelGroups: UnitDescriptionLabelGroup[] = [
  {
    title: "Floor / Exposure",
    options: [
      { value: "High Floor", category: "floor" },
      { value: "Top Floor", category: "floor" },
      { value: "Corner Unit", category: "floor" },
      { value: "South Facing", category: "floor" },
      { value: "North Facing", category: "floor" },
      { value: "East Facing", category: "floor" },
      { value: "West Facing", category: "floor" }
    ]
  },
  {
    title: "View",
    options: [
      { value: "River View", category: "view" },
      { value: "Skyline View", category: "view" },
      { value: "City View", category: "view" },
      { value: "Open View", category: "view" },
      { value: "Park View", category: "view" }
    ]
  },
  {
    title: "Layout",
    options: [
      { value: "Efficient Layout", category: "layout" },
      { value: "Alcove Layout", category: "layout" },
      { value: "Split Bedrooms", category: "layout" },
      { value: "Open Kitchen", category: "layout" },
      { value: "Walk-in Closet", category: "layout" },
      { value: "Home Office", category: "layout" }
    ]
  },
  {
    title: "Features",
    options: [
      { value: "Private Balcony", category: "feature" },
      { value: "Private Terrace", category: "feature" },
      { value: "Renovated", category: "feature" },
      { value: "Floor-to-ceiling Windows", category: "feature" },
      { value: "Quiet Side", category: "feature" }
    ]
  }
];

export const unitDescriptionLabelOptions = unitDescriptionLabelGroups.flatMap((group) => group.options);

const canonicalLabelByKey = new Map<string, string>();

unitDescriptionLabelOptions.forEach((option) => {
  canonicalLabelByKey.set(unitDescriptionLabelKey(option.value), option.value);
});

Object.entries({
  "corner": "Corner Unit",
  "corner view": "Corner Unit",
  "corner unit": "Corner Unit",
  "east exposure": "East Facing",
  "east facing": "East Facing",
  "facing east": "East Facing",
  "facing north": "North Facing",
  "facing south": "South Facing",
  "facing west": "West Facing",
  "floor to ceiling windows": "Floor-to-ceiling Windows",
  "high floor": "High Floor",
  "north exposure": "North Facing",
  "north facing": "North Facing",
  "open kitchen": "Open Kitchen",
  "private balcony": "Private Balcony",
  "private terrace": "Private Terrace",
  "quiet": "Quiet Side",
  "quiet side": "Quiet Side",
  "river": "River View",
  "river view": "River View",
  "skyline": "Skyline View",
  "skyline view": "Skyline View",
  "south exposure": "South Facing",
  "south facing": "South Facing",
  "top floor": "Top Floor",
  "walk in closet": "Walk-in Closet",
  "west exposure": "West Facing",
  "west facing": "West Facing"
}).forEach(([alias, label]) => {
  canonicalLabelByKey.set(unitDescriptionLabelKey(alias), label);
});

export function normalizeUnitDescriptionLabel(value: string) {
  const trimmedValue = value.trim().replace(/\s+/g, " ");

  if (!trimmedValue) {
    return "";
  }

  return canonicalLabelByKey.get(unitDescriptionLabelKey(trimmedValue)) ?? trimmedValue;
}

export function normalizeUnitDescriptionLabels(values: readonly string[] | null | undefined) {
  const labels: string[] = [];
  const seen = new Set<string>();

  (values ?? []).forEach((value) => {
    const label = normalizeUnitDescriptionLabel(value);
    const key = unitDescriptionLabelKey(label);

    if (!label || seen.has(key)) {
      return;
    }

    seen.add(key);
    labels.push(label);
  });

  return labels;
}

export function toggleUnitDescriptionLabel(values: readonly string[], value: string) {
  const labels = normalizeUnitDescriptionLabels(values);
  const label = normalizeUnitDescriptionLabel(value);

  if (!label) {
    return labels;
  }

  const key = unitDescriptionLabelKey(label);
  const hasLabel = labels.some((item) => unitDescriptionLabelKey(item) === key);

  if (hasLabel) {
    return labels.filter((item) => unitDescriptionLabelKey(item) !== key);
  }

  return [...labels, label];
}

export function unitDescriptionLabelKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
