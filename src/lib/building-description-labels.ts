export type BuildingDescriptionLabelOption = {
  value: string;
  category: "type" | "location";
};

export type BuildingDescriptionLabelGroup = {
  title: string;
  options: BuildingDescriptionLabelOption[];
};

export const buildingDescriptionLabelGroups: BuildingDescriptionLabelGroup[] = [
  {
    title: "Building Type",
    options: [
      { value: "High Rise", category: "type" },
      { value: "Mid Rise", category: "type" },
      { value: "Low Rise", category: "type" },
      { value: "New Development", category: "type" },
      { value: "Prewar", category: "type" },
      { value: "Boutique Building", category: "type" },
      { value: "Luxury Building", category: "type" },
      { value: "Elevator Building", category: "type" },
      { value: "Walk-up", category: "type" }
    ]
  },
  {
    title: "Transit / Location Feel",
    options: [
      { value: "Near Subway", category: "location" },
      { value: "Near PATH", category: "location" },
      { value: "Near Ferry", category: "location" },
      { value: "Transit Friendly", category: "location" },
      { value: "Waterfront", category: "location" },
      { value: "Park Nearby", category: "location" },
      { value: "Quiet Street", category: "location" },
      { value: "Central Location", category: "location" }
    ]
  }
];

export const buildingDescriptionLabelOptions = buildingDescriptionLabelGroups.flatMap((group) => group.options);

const canonicalLabelByKey = new Map<string, string>();

buildingDescriptionLabelOptions.forEach((option) => {
  canonicalLabelByKey.set(buildingDescriptionLabelKey(option.value), option.value);
});

Object.entries({
  "boutique": "Boutique Building",
  "boutique building": "Boutique Building",
  "central": "Central Location",
  "central location": "Central Location",
  "elevator": "Elevator Building",
  "elevator building": "Elevator Building",
  "ferry": "Near Ferry",
  "high rise": "High Rise",
  "highrise": "High Rise",
  "luxury": "Luxury Building",
  "luxury building": "Luxury Building",
  "low rise": "Low Rise",
  "lowrise": "Low Rise",
  "mid rise": "Mid Rise",
  "midrise": "Mid Rise",
  "near ferry": "Near Ferry",
  "near path": "Near PATH",
  "near subway": "Near Subway",
  "new building": "New Development",
  "new development": "New Development",
  "park nearby": "Park Nearby",
  "path": "Near PATH",
  "pre war": "Prewar",
  "pre-war": "Prewar",
  "prewar": "Prewar",
  "quiet": "Quiet Street",
  "quiet street": "Quiet Street",
  "subway": "Near Subway",
  "transit": "Transit Friendly",
  "transit friendly": "Transit Friendly",
  "walk up": "Walk-up",
  "walk-up": "Walk-up",
  "water front": "Waterfront",
  "waterfront": "Waterfront"
}).forEach(([alias, label]) => {
  canonicalLabelByKey.set(buildingDescriptionLabelKey(alias), label);
});

export function normalizeBuildingDescriptionLabel(value: string) {
  const trimmedValue = value.trim().replace(/\s+/g, " ");

  if (!trimmedValue) {
    return "";
  }

  return canonicalLabelByKey.get(buildingDescriptionLabelKey(trimmedValue)) ?? trimmedValue;
}

export function normalizeBuildingDescriptionLabels(values: readonly string[] | null | undefined) {
  const labels: string[] = [];
  const seen = new Set<string>();

  (values ?? []).forEach((value) => {
    const label = normalizeBuildingDescriptionLabel(value);
    const key = buildingDescriptionLabelKey(label);

    if (!label || seen.has(key)) {
      return;
    }

    seen.add(key);
    labels.push(label);
  });

  return labels;
}

export function toggleBuildingDescriptionLabel(values: readonly string[], value: string) {
  const labels = normalizeBuildingDescriptionLabels(values);
  const label = normalizeBuildingDescriptionLabel(value);

  if (!label) {
    return labels;
  }

  const key = buildingDescriptionLabelKey(label);
  const hasLabel = labels.some((item) => buildingDescriptionLabelKey(item) === key);

  if (hasLabel) {
    return labels.filter((item) => buildingDescriptionLabelKey(item) !== key);
  }

  return [...labels, label];
}

export function buildingDescriptionLabelKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
