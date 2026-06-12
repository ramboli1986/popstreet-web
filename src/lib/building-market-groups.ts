export type BuildingLocationParentValue = "nj" | "manhattan" | "queens" | "brooklyn" | "other";

export type BuildingLocationFilterOption = {
  value: string;
  label: string;
  count: number;
  depth: 0 | 1;
};

type BuildingMarketSource = {
  area?: string | null;
  city?: string | null;
  state?: string | null;
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
  { value: "manhattan", label: "Manhattan" },
  { value: "queens", label: "Queens" },
  { value: "brooklyn", label: "Brooklyn" }
];

const fixedChildrenByParent: Partial<Record<BuildingLocationParentValue, BuildingLocationChild[]>> = {
  manhattan: [
    { value: "downtown-manhattan", label: "Downtown Manhattan" },
    { value: "midtown-manhattan", label: "Midtown Manhattan" },
    { value: "upper-east-side", label: "Upper East Side" },
    { value: "upper-west-side", label: "Upper West Side" }
  ],
  queens: [
    { value: "lic", label: "LIC" },
    { value: "astoria", label: "Astoria" }
  ],
  brooklyn: [{ value: "brooklyn", label: "Brooklyn" }]
};

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
    return "manhattan";
  }

  return "other";
}

export function buildingLocationFilterOptions(buildings: BuildingMarketSource[]) {
  const parentCounts = new Map<BuildingLocationParentValue, number>();
  const childCountsByParent = new Map<BuildingLocationParentValue, Map<string, { label: string; count: number }>>();

  buildings.forEach((building) => {
    const parent = buildingLocationParentFor(building);
    const child = buildingLocationChildFor(building, parent);
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

  const child = buildingLocationChildFor(building, parent);

  return locationFilter === childFilterValue(parent, child.value);
}

export function buildingLocationFilterValueExists(options: BuildingLocationFilterOption[], locationFilter: string) {
  return locationFilter === "all" || options.some((option) => option.value === locationFilter);
}

function childOptionsForParent(
  parent: BuildingLocationParentValue,
  childCounts: Map<string, { label: string; count: number }> | undefined
) {
  if (parent === "nj") {
    return Array.from(childCounts?.entries() ?? [])
      .map(([value, child]) => ({
        value: childFilterValue(parent, value),
        label: child.label,
        count: child.count,
        depth: 1 as const
      }))
      .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label));
  }

  const fixedChildren = fixedChildrenByParent[parent] ?? [];
  const fixedChildValues = new Set(fixedChildren.map((child) => child.value));
  const options = fixedChildren.map((child) => ({
    value: childFilterValue(parent, child.value),
    label: child.label,
    count: childCounts?.get(child.value)?.count ?? 0,
    depth: 1 as const
  }));
  const extraChildren = Array.from(childCounts?.entries() ?? [])
    .filter(([value]) => !fixedChildValues.has(value))
    .map(([value, child]) => ({
      value: childFilterValue(parent, value),
      label: child.label,
      count: child.count,
      depth: 1 as const
    }))
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label));

  return [...options, ...extraChildren];
}

function buildingLocationChildFor(
  building: BuildingMarketSource,
  parent: BuildingLocationParentValue
): BuildingLocationChild {
  const searchableLocation = searchableLocationFor(building);

  if (parent === "nj") {
    const label = building.area || building.neighborhoods?.name || building.city || "Other";
    return { value: slugifyLocation(label), label };
  }

  if (parent === "manhattan") {
    if (hasAnySignal(searchableLocation, downtownManhattanSignals)) {
      return { value: "downtown-manhattan", label: "Downtown Manhattan" };
    }

    if (hasAnySignal(searchableLocation, midtownManhattanSignals)) {
      return { value: "midtown-manhattan", label: "Midtown Manhattan" };
    }

    if (hasAnySignal(searchableLocation, upperEastSideSignals)) {
      return { value: "upper-east-side", label: "Upper East Side" };
    }

    if (hasAnySignal(searchableLocation, upperWestSideSignals)) {
      return { value: "upper-west-side", label: "Upper West Side" };
    }

    return { value: "other-manhattan", label: "Other Manhattan" };
  }

  if (parent === "queens") {
    if (hasAnySignal(searchableLocation, astoriaSignals)) {
      return { value: "astoria", label: "Astoria" };
    }

    if (hasAnySignal(searchableLocation, licSignals)) {
      return { value: "lic", label: "LIC" };
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
  return [building.area, building.neighborhoods?.name, building.city]
    .filter(Boolean)
    .map((value) => normalizeLocationText(value!))
    .join(" ");
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

function slugifyLocation(value: string) {
  return normalizeLocationText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "other";
}
