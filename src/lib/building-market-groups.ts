export type BuildingLocationParentValue =
  | "nj"
  | "manhattan-downtown"
  | "manhattan-midtown"
  | "manhattan-upper-east"
  | "manhattan-upper-west"
  | "queens"
  | "brooklyn"
  | "other";

export type BuildingLocationFilterOption = {
  value: string;
  label: string;
  count: number;
  depth: 0 | 1;
};

export type BuildingMapRegionOption = {
  value: string;
  label: string;
  count: number;
};

type BuildingMarketSource = {
  area?: string | null;
  city?: string | null;
  state?: string | null;
  description_labels?: string[] | null;
  neighborhoods?: {
    name?: string | null;
  } | null;
};

type BuildingLocationChild = {
  value: string;
  label: string;
};

const fixedParents: Array<{ value: BuildingLocationParentValue; label: string }> = [
  { value: "nj", label: "NJ" },
  { value: "manhattan-downtown", label: "Manhattan Downtown" },
  { value: "manhattan-midtown", label: "Manhattan Midtown" },
  { value: "manhattan-upper-east", label: "Manhattan Upper East" },
  { value: "manhattan-upper-west", label: "Manhattan Upper West" },
  { value: "queens", label: "Queens" },
  { value: "brooklyn", label: "Brooklyn" }
];

const downtownManhattanSignals = [
  "downtown manhattan",
  "financial district",
  "fidi",
  "tribeca",
  "soho",
  "nolita",
  "lower east side",
  "east village",
  "west village",
  "greenwich village",
  "noho",
  "chinatown",
  "two bridges",
  "battery park",
  "battery park city",
  "civic center"
];
const midtownManhattanSignals = [
  "midtown manhattan",
  "midtown",
  "chelsea",
  "hells kitchen",
  "hell's kitchen",
  "hudson yards",
  "murray hill",
  "kips bay",
  "nomad",
  "flatiron",
  "gramercy",
  "theater district",
  "turtle bay"
];
const upperEastSideSignals = ["upper east side", "yorkville", "lenox hill", "carnegie hill"];
const upperWestSideSignals = ["upper west side", "lincoln square", "manhattan valley", "morningside heights"];
const licSignals = ["lic", "long island city", "hunters point", "hunter's point"];
const astoriaSignals = ["astoria"];
const brooklynSignals = [
  "brooklyn",
  "williamsburg",
  "greenpoint",
  "dumbo",
  "downtown brooklyn",
  "fort greene",
  "park slope",
  "bushwick",
  "bedford-stuyvesant",
  "bed stuy"
];

const jerseyCityCanonicalAreaAliases = [
  {
    label: "Downtown Jersey City",
    aliases: ["downtown", "downtown jersey city", "historic downtown", "historic downtown jersey city"]
  },
  {
    label: "Waterfront",
    aliases: ["jersey city waterfront", "the waterfront", "waterfront", "waterfront jersey city"]
  },
  {
    label: "Newport",
    aliases: ["newport", "newport jersey city"]
  }
];
const queensCanonicalAreaAliases = [
  {
    label: "Long Island City",
    aliases: ["hunters point", "hunter's point", "lic", "long island city"]
  }
];

const mapRegionOrder = [
  parentFilterValue("nj"),
  parentFilterValue("manhattan-downtown"),
  parentFilterValue("manhattan-midtown"),
  parentFilterValue("manhattan-upper-east"),
  parentFilterValue("manhattan-upper-west"),
  childFilterValue("queens", "lic"),
  childFilterValue("queens", "astoria"),
  parentFilterValue("brooklyn"),
  parentFilterValue("other")
];

export function canonicalBuildingAreaLabel(
  area: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined
) {
  const label = normalizeLocationDisplay(area);

  if (!label) {
    return "";
  }

  if (isJerseyCityNJ(city, state)) {
    const normalizedArea = normalizeLocationText(label);
    const canonicalArea = jerseyCityCanonicalAreaAliases.find((item) =>
      item.aliases.some((alias) => normalizeLocationText(alias) === normalizedArea)
    );

    if (canonicalArea) {
      return canonicalArea.label;
    }
  }

  if (isQueensNY(city, state) || isLongIslandCityNY(city, state)) {
    const normalizedArea = normalizeLocationText(label);
    const canonicalArea = queensCanonicalAreaAliases.find((item) =>
      item.aliases.some((alias) => normalizeLocationText(alias) === normalizedArea)
    );

    if (canonicalArea) {
      return canonicalArea.label;
    }
  }

  return label;
}

export function canonicalBuildingAreaKey(
  area: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined
) {
  return slugifyLocation(canonicalBuildingAreaLabel(area, city, state));
}

export function buildingMapRegionFor(building: BuildingMarketSource): Pick<BuildingMapRegionOption, "label" | "value"> {
  const parent = buildingLocationParentFor(building);

  if (parent !== "queens") {
    return {
      value: parentFilterValue(parent),
      label: fixedParents.find((option) => option.value === parent)?.label ?? "Other"
    };
  }

  const child = buildingLocationChildFor(building, parent);

  return {
    value: childFilterValue(parent, child.value),
    label: child.label
  };
}

export function buildingMapRegionOptions(buildings: BuildingMarketSource[]) {
  const optionsByValue = new Map<string, BuildingMapRegionOption>();

  buildings.forEach((building) => {
    const region = buildingMapRegionFor(building);
    const current = optionsByValue.get(region.value) ?? { ...region, count: 0 };

    optionsByValue.set(region.value, { ...current, count: current.count + 1 });
  });

  return Array.from(optionsByValue.values()).sort((first, second) => {
    const firstPreferredIndex = mapRegionOrder.indexOf(first.value);
    const secondPreferredIndex = mapRegionOrder.indexOf(second.value);

    if (firstPreferredIndex !== -1 || secondPreferredIndex !== -1) {
      return (firstPreferredIndex === -1 ? 999 : firstPreferredIndex) - (secondPreferredIndex === -1 ? 999 : secondPreferredIndex);
    }

    return second.count - first.count || first.label.localeCompare(second.label);
  });
}

export function buildingMatchesMapRegion(building: BuildingMarketSource, regionValue: string) {
  return regionValue === "all" || buildingMapRegionFor(building).value === regionValue;
}

export function buildingLocationParentFor(building: BuildingMarketSource): BuildingLocationParentValue {
  if (normalizeToken(building.state) === "nj") {
    return "nj";
  }

  const searchableLocation = searchableLocationFor(building);
  const normalizedCity = normalizeToken(building.city);

  if (hasAnySignal(searchableLocation, brooklynSignals) || normalizedCity === "brooklyn") {
    return "brooklyn";
  }

  if (
    hasAnySignal(searchableLocation, [...licSignals, ...astoriaSignals]) ||
    normalizedCity === "queens"
  ) {
    return "queens";
  }

  if (
    normalizedCity === "newyork" ||
    searchableLocation.includes("manhattan") ||
    hasAnySignal(searchableLocation, [
      ...downtownManhattanSignals,
      ...midtownManhattanSignals,
      ...upperEastSideSignals,
      ...upperWestSideSignals
    ])
  ) {
    if (hasAnySignal(searchableLocation, downtownManhattanSignals)) {
      return "manhattan-downtown";
    }

    if (hasAnySignal(searchableLocation, midtownManhattanSignals)) {
      return "manhattan-midtown";
    }

    if (hasAnySignal(searchableLocation, upperEastSideSignals)) {
      return "manhattan-upper-east";
    }

    if (hasAnySignal(searchableLocation, upperWestSideSignals)) {
      return "manhattan-upper-west";
    }

    return "manhattan-midtown";
  }

  return "other";
}

export function buildingLocationFilterOptions(buildings: BuildingMarketSource[]) {
  const parentCounts = new Map<BuildingLocationParentValue, number>();
  const childCountsByParent = new Map<BuildingLocationParentValue, Map<string, { label: string; count: number }>>();

  buildings.forEach((building) => {
    const parent = buildingLocationParentFor(building);
    const child = buildingLocationAreaChildFor(building, parent);
    const childCounts = childCountsByParent.get(parent) ?? new Map<string, { label: string; count: number }>();
    const childCount = childCounts.get(child.value) ?? { label: child.label, count: 0 };

    parentCounts.set(parent, (parentCounts.get(parent) ?? 0) + 1);
    childCounts.set(child.value, { ...childCount, count: childCount.count + 1 });
    childCountsByParent.set(parent, childCounts);
  });

  const options: BuildingLocationFilterOption[] = [];
  const parents = [...fixedParents];
  const otherCount = parentCounts.get("other") ?? 0;

  if (otherCount > 0) {
    parents.push({ value: "other", label: "Other" });
  }

  parents.forEach((parent) => {
    options.push({
      value: parentFilterValue(parent.value),
      label: parent.label,
      count: parentCounts.get(parent.value) ?? 0,
      depth: 0
    });

    options.push(...childOptionsForParent(parent.value, childCountsByParent.get(parent.value)));
  });

  return options;
}

export function buildingMatchesLocationFilter(building: BuildingMarketSource, locationFilter: string) {
  if (locationFilter === "all") {
    return true;
  }

  const parent = buildingLocationParentFor(building);

  if (locationFilter === parentFilterValue(parent)) {
    return true;
  }

  const child = buildingLocationAreaChildFor(building, parent);

  return locationFilter === childFilterValue(parent, child.value);
}

export function buildingLocationFilterValueExists(options: BuildingLocationFilterOption[], locationFilter: string) {
  return locationFilter === "all" || options.some((option) => option.value === locationFilter);
}

export function buildingLocationFilterOptionLabel(
  option: Pick<BuildingLocationFilterOption, "count" | "depth" | "label">,
  locale: string,
  allLabel: string
) {
  const count = option.count.toLocaleString(locale);

  if (option.depth === 0) {
    return `${option.label} (${allLabel} ${count})`;
  }

  return `↳ ${option.label} (${count})`;
}

export function buildingLocationFilterOptionDisplay(
  option: Pick<BuildingLocationFilterOption, "count" | "depth" | "label">,
  locale: string,
  allLabel: string
) {
  const count = option.count.toLocaleString(locale);

  return {
    countLabel: option.depth === 0 ? `${allLabel} ${count}` : count,
    label: option.label,
    level: option.depth
  };
}

function childOptionsForParent(
  parent: BuildingLocationParentValue,
  childCounts: Map<string, { label: string; count: number }> | undefined
) {
  return Array.from(childCounts?.entries() ?? [])
    .map(([value, child]) => ({
      value: childFilterValue(parent, value),
      label: child.label,
      count: child.count,
      depth: 1 as const
    }))
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label));
}

function buildingLocationAreaChildFor(
  building: BuildingMarketSource,
  parent: BuildingLocationParentValue
): BuildingLocationChild {
  const rawLabel =
    parent === "brooklyn" && normalizeLocationText(building.area) === "brooklyn" && building.neighborhoods?.name
      ? building.neighborhoods.name
      : building.area || building.neighborhoods?.name;
  const label = canonicalBuildingAreaLabel(rawLabel, building.city, building.state);

  if (label) {
    return { value: buildingLocationAreaChildValue(label, parent), label };
  }

  return buildingLocationChildFor(building, parent);
}

function buildingLocationAreaChildValue(label: string, parent: BuildingLocationParentValue) {
  if (parent === "queens" && normalizeLocationText(label) === "long island city") {
    return "lic";
  }

  return slugifyLocation(label);
}

function buildingLocationChildFor(
  building: BuildingMarketSource,
  parent: BuildingLocationParentValue
): BuildingLocationChild {
  const searchableLocation = searchableLocationFor(building);

  if (parent === "nj") {
    const rawLabel = building.area || building.neighborhoods?.name || building.city || "Other";
    const label = canonicalBuildingAreaLabel(rawLabel, building.city, building.state) || rawLabel;
    return { value: slugifyLocation(label), label };
  }

  if (isManhattanParent(parent)) {
    return {
      value: parent.replace(/^manhattan-/, ""),
      label: fixedParents.find((option) => option.value === parent)?.label ?? "Manhattan"
    };
  }

  if (parent === "queens") {
    if (hasAnySignal(searchableLocation, astoriaSignals)) {
      return { value: "astoria", label: "Astoria" };
    }

    if (hasAnySignal(searchableLocation, licSignals)) {
      return { value: "lic", label: "Long Island City" };
    }

    return { value: "other-queens", label: "Other Queens" };
  }

  if (parent === "brooklyn") {
    return { value: "brooklyn", label: "Brooklyn" };
  }

  return { value: "other", label: "Other" };
}

function parentFilterValue(parent: BuildingLocationParentValue) {
  return `parent:${parent}`;
}

function childFilterValue(parent: BuildingLocationParentValue, child: string) {
  return `child:${parent}:${child}`;
}

function searchableLocationFor(building: BuildingMarketSource) {
  return [building.area, building.neighborhoods?.name, building.city, ...(building.description_labels ?? [])]
    .filter(Boolean)
    .map((value) => normalizeLocationText(value!))
    .join(" ");
}

function isManhattanParent(parent: BuildingLocationParentValue) {
  return parent.startsWith("manhattan-");
}

function hasAnySignal(value: string, signals: string[]) {
  return signals.some((signal) => value.includes(signal));
}

function normalizeToken(value: string | null | undefined) {
  return normalizeLocationText(value).replace(/\s+/g, "");
}

function normalizeLocationText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLocationDisplay(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isJerseyCityNJ(city: string | null | undefined, state: string | null | undefined) {
  return normalizeToken(city) === "jerseycity" && normalizeToken(state) === "nj";
}

function isQueensNY(city: string | null | undefined, state: string | null | undefined) {
  return normalizeToken(city) === "queens" && normalizeToken(state) === "ny";
}

function isLongIslandCityNY(city: string | null | undefined, state: string | null | undefined) {
  return normalizeToken(city) === "longislandcity" && normalizeToken(state) === "ny";
}

function slugifyLocation(value: string) {
  return normalizeLocationText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "other";
}
