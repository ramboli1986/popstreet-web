import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(
  new URL("../src/lib/building-market-groups.ts", import.meta.url).pathname,
);

const {
  buildingLocationFilterOptions,
  buildingMapRegionFor,
  buildingMatchesLocationFilter,
  canonicalBuildingAreaLabel,
} = await import(moduleUrl.href);

test("canonicalizes LIC area aliases to Long Island City", () => {
  const city = "Queens";
  const state = "NY";

  assert.equal(canonicalBuildingAreaLabel("Hunters Point", city, state), "Long Island City");
  assert.equal(canonicalBuildingAreaLabel("LIC", city, state), "Long Island City");
  assert.equal(canonicalBuildingAreaLabel("Long island city", city, state), "Long Island City");
});

test("groups LIC aliases under the Long Island City location filter", () => {
  const buildings = [
    { id: "1", area: "Hunters Point", city: "Queens", state: "NY" },
    { id: "2", area: "LIC", city: "Queens", state: "NY" },
    { id: "3", area: "Long island city", city: "Queens", state: "NY" },
  ];

  const options = buildingLocationFilterOptions(buildings);
  const licOption = options.find((option) => option.value === "child:queens:lic");

  assert.equal(licOption?.label, "Long Island City");
  assert.equal(licOption?.count, 3);
  assert.equal(options.some((option) => option.label === "Hunters Point"), false);
  assert.equal(options.some((option) => option.label === "LIC"), false);

  assert.deepEqual(buildingMapRegionFor(buildings[0]), {
    value: "child:queens:lic",
    label: "Long Island City",
  });
  assert.equal(buildingMatchesLocationFilter(buildings[1], "child:queens:lic"), true);
});

test("derives Brooklyn area filters from building data", () => {
  const buildings = [
    { id: "1", area: "Bedford-Stuyvesant", city: "Brooklyn", state: "NY" },
    { id: "2", area: "Downtown Brooklyn", city: "Brooklyn", state: "NY" },
    { id: "3", area: "Downtown Brooklyn", city: "Brooklyn", state: "NY" },
  ];

  const options = buildingLocationFilterOptions(buildings);
  const brooklynParent = options.find((option) => option.value === "parent:brooklyn");
  const bedStuyOption = options.find((option) => option.value === "child:brooklyn:bedford-stuyvesant");
  const downtownOption = options.find((option) => option.value === "child:brooklyn:downtown-brooklyn");

  assert.equal(brooklynParent?.label, "Brooklyn");
  assert.equal(brooklynParent?.count, 3);
  assert.equal(brooklynParent?.depth, 0);
  assert.equal(bedStuyOption?.label, "Bedford-Stuyvesant");
  assert.equal(bedStuyOption?.count, 1);
  assert.equal(bedStuyOption?.depth, 1);
  assert.equal(downtownOption?.label, "Downtown Brooklyn");
  assert.equal(downtownOption?.count, 2);
  assert.equal(buildingMatchesLocationFilter(buildings[0], "parent:brooklyn"), true);
  assert.equal(buildingMatchesLocationFilter(buildings[0], "child:brooklyn:bedford-stuyvesant"), true);
  assert.equal(buildingMatchesLocationFilter(buildings[0], "child:brooklyn:downtown-brooklyn"), false);
});

test("uses Brooklyn neighborhood when legacy area only says Brooklyn", () => {
  const buildings = [
    {
      id: "1",
      area: "Brooklyn",
      city: "Brooklyn",
      state: "NY",
      neighborhoods: { name: "Williamsburg" },
    },
  ];

  const options = buildingLocationFilterOptions(buildings);

  assert.equal(options.some((option) => option.value === "child:brooklyn:brooklyn"), false);
  assert.equal(options.find((option) => option.value === "child:brooklyn:williamsburg")?.count, 1);
  assert.equal(buildingMatchesLocationFilter(buildings[0], "child:brooklyn:williamsburg"), true);
});
