"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Building2, CircleSlash, DollarSign, RefreshCcw, Sparkles, Tag } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate, formatMoneyFromCents } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Building, UnitListing } from "@/lib/types";

type AvailableUnitAreaRow = Pick<UnitListing, "id" | "unit_id"> & {
  units: {
    id: string;
    building_id: string;
    buildings: {
      id: string;
      area: string | null;
      city: string;
      state: string;
    } | null;
  } | null | {
    id: string;
    building_id: string;
    buildings: {
      id: string;
      area: string | null;
      city: string;
      state: string;
    } | null;
  }[];
};

type AreaUnitStat = {
  area: string;
  availableBuildings: number;
  availableUnits: number;
  percent: number;
};

export function Dashboard() {
  const { language, t } = useI18n();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingCount, setBuildingCount] = useState(0);
  const [availableBuildingCount, setAvailableBuildingCount] = useState(0);
  const [unitsCount, setUnitsCount] = useState(0);
  const [listings, setListings] = useState<UnitListing[]>([]);
  const [availableUnitRows, setAvailableUnitRows] = useState<AvailableUnitAreaRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard() {
    setIsLoading(true);
    setError(null);

    const [
      buildingResult,
      buildingCountResult,
      unitResult,
      listingResult,
      availableUnitsResult
    ] = await Promise.all([
      supabase
        .from("buildings")
        .select("*, neighborhoods(name, slug)")
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase.from("buildings").select("id", { count: "exact", head: true }),
      supabase.from("units").select("id", { count: "exact", head: true }),
      supabase
        .from("unit_listings")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(500),
      supabase
        .from("unit_listings")
        .select(
          [
            "id",
            "unit_id",
            "units(id, building_id, buildings(id, area, city, state))"
          ].join(",")
        )
        .eq("status", "available")
        .limit(10000)
    ]);

    if (
      buildingResult.error ||
      buildingCountResult.error ||
      unitResult.error ||
      listingResult.error ||
      availableUnitsResult.error
    ) {
      setError(
        buildingResult.error?.message ??
          buildingCountResult.error?.message ??
          unitResult.error?.message ??
          listingResult.error?.message ??
          availableUnitsResult.error?.message ??
          "Load failed"
      );
    } else {
      const nextAvailableUnitRows = (availableUnitsResult.data ?? []) as unknown as AvailableUnitAreaRow[];

      setBuildings((buildingResult.data ?? []) as Building[]);
      setBuildingCount(buildingCountResult.count ?? 0);
      setAvailableBuildingCount(countAvailableBuildings(nextAvailableUnitRows));
      setUnitsCount(unitResult.count ?? 0);
      setListings((listingResult.data ?? []) as UnitListing[]);
      setAvailableUnitRows(nextAvailableUnitRows);
    }

    setIsLoading(false);
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const areaUnitStats = useMemo(() => buildAreaUnitStats(availableUnitRows), [availableUnitRows]);
  const availableUnitsByBuilding = useMemo(() => buildAvailableUnitsByBuilding(availableUnitRows), [availableUnitRows]);
  const availableUnitCount = useMemo(() => countAvailableUnits(availableUnitRows), [availableUnitRows]);

  const stats = useMemo(() => {
    const availableListings = listings.filter((listing) => listing.status === "available");
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTime = todayStart.getTime();
    const sortedNetPrices = availableListings
      .map((listing) => listing.net_price_cents)
      .filter((value) => Number.isFinite(value))
      .sort((first, second) => first - second);
    const minNetPrice = availableListings.reduce<number | null>((min, listing) => {
      if (listing.net_price_cents == null) {
        return min;
      }

      return min == null ? listing.net_price_cents : Math.min(min, listing.net_price_cents);
    }, null);
    const medianIndex = Math.floor(sortedNetPrices.length / 2);
    const medianNetPrice =
      sortedNetPrices.length === 0
        ? null
        : sortedNetPrices.length % 2 === 0
          ? Math.round((sortedNetPrices[medianIndex - 1] + sortedNetPrices[medianIndex]) / 2)
          : sortedNetPrices[medianIndex];

    return {
      totalBuildings: buildingCount,
      activeBuildings: availableBuildingCount,
      totalUnits: unitsCount,
      availableListings: availableUnitCount,
      minNetPrice,
      medianNetPrice,
      newToday: listings.filter((listing) => new Date(listing.listed_at).getTime() >= todayTime).length,
      offMarketToday: listings.filter(
        (listing) => listing.unavailable_at && new Date(listing.unavailable_at).getTime() >= todayTime
      ).length
    };
  }, [availableBuildingCount, availableUnitCount, buildingCount, listings, unitsCount]);

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const trendBuckets = useMemo(() => buildTrendBuckets(listings, locale), [listings, locale]);

  return (
    <div className="dashboard-page">
      <div className="page-hero">
        <div>
          <div className="eyebrow">{t("dashboard.eyebrow")}</div>
          <h1>{t("dashboard.title")}</h1>
          <p>
            {t("dashboard.subtitle", {
              buildings: stats.totalBuildings.toLocaleString(locale),
              listings: stats.availableListings.toLocaleString(locale)
            })}
          </p>
        </div>
        <div className="page-actions">
          <div className="segmented-control" aria-hidden="true">
            <span className="active">{t("dashboard.today")}</span>
            <span>{t("dashboard.sevenDays")}</span>
            <span>{t("dashboard.thirtyDays")}</span>
          </div>
          <button className="button dark-button" disabled={isLoading} onClick={loadDashboard} type="button">
            <RefreshCcw size={16} />
            {t("common.refresh")}
          </button>
        </div>
      </div>

      {error ? <div className="message error">{error}</div> : null}

      <section className="kpi-strip">
        <MetricCard
          icon={<Building2 size={17} />}
          label={t("dashboard.activeBuildings")}
          value={`${stats.activeBuildings.toLocaleString(locale)}`}
          suffix={`/ ${stats.totalBuildings.toLocaleString(locale)}`}
          trend="up"
          trendText={t("dashboard.liveInventory")}
        />
        <MetricCard
          icon={<Tag size={17} />}
          label={t("dashboard.activeDeals")}
          value={stats.availableListings.toLocaleString(locale)}
          trend="up"
          trendText={t("dashboard.availableNow")}
        />
        <MetricCard
          icon={<Sparkles size={17} />}
          label={t("dashboard.newToday")}
          value={`+${stats.newToday.toLocaleString(locale)}`}
          tone="brand"
          trendText={t("dashboard.freshListings")}
        />
        <MetricCard
          icon={<CircleSlash size={17} />}
          label={t("dashboard.offMarketToday")}
          value={`-${stats.offMarketToday.toLocaleString(locale)}`}
          tone="danger"
          trendText={t("dashboard.removedToday")}
        />
        <MetricCard
          icon={<DollarSign size={17} />}
          label={t("dashboard.medianNetRent")}
          value={formatMoneyFromCents(stats.medianNetPrice ?? stats.minNetPrice)}
          trend="down"
          trendText={t("dashboard.currentAvailable")}
        />
      </section>

      <section className="dashboard-main-grid">
        <article className="analytics-card activity-card">
          <div className="card-heading">
            <div>
              <div className="eyebrow">{t("dashboard.dailyActivity")}</div>
              <h3>{t("dashboard.newVsUnavailable")}</h3>
            </div>
            <div className="chart-legend">
              <span><i className="legend-new" />{t("dashboard.new")}</span>
              <span><i className="legend-off" />{t("common.unavailable")}</span>
            </div>
          </div>
          <ActivityBars buckets={trendBuckets} />
        </article>

        <article className="analytics-card area-unit-card">
          <div className="card-heading">
            <div>
              <div className="eyebrow">{t("dashboard.areaInventory")}</div>
              <h3>{t("dashboard.unitsByArea")}</h3>
            </div>
            <span className="count-pill">{t("dashboard.availableAreas", { count: areaUnitStats.length.toLocaleString(locale) })}</span>
          </div>

          <AreaUnitStats rows={areaUnitStats} locale={locale} t={t} />
        </article>
      </section>

      <section className="dashboard-secondary-grid single-column">
        <article className="analytics-card">
          <div className="card-heading">
            <div>
              <div className="eyebrow">{t("dashboard.recentlyUpdated")}</div>
              <h3>{t("common.buildings")}</h3>
            </div>
            <span className="count-pill">{t("dashboard.latest", { count: buildings.length.toLocaleString(locale) })}</span>
          </div>

          <div className="recent-building-list">
            {buildings.map((building) => {
              const availableCount = availableUnitsByBuilding.get(building.id) ?? 0;

              return (
                <div className="recent-building-row" key={building.id}>
                  <div>
                    <strong>{building.name}</strong>
                    <p className="muted">
                      {building.area ?? building.neighborhoods?.name ?? building.city}, {building.state}
                    </p>
                  </div>
                  <span className="count-pill">
                    {t("dashboard.availableUnitCount", {
                      count: availableCount.toLocaleString(locale)
                    })}
                  </span>
                  <span className="muted">{formatDate(building.updated_at)}</span>
                </div>
              );
            })}
          </div>
        </article>
      </section>
    </div>
  );
}

type Translate = (key: string, params?: Record<string, number | string>) => string;

function AreaUnitStats({ locale, rows, t }: { locale: string; rows: AreaUnitStat[]; t: Translate }) {
  return (
    <div className="breakdown-list area-unit-list">
      {rows.length === 0 ? (
        <div className="empty-state compact-empty">
          <strong>{t("dashboard.noAreaUnits")}</strong>
          <p>{t("dashboard.noAreaUnitsHint")}</p>
        </div>
      ) : null}
      {rows.map((row) => (
        <div className="breakdown-row area-unit-row" key={row.area}>
          <div>
            <strong>{row.area}</strong>
            <span>
              {t("dashboard.areaUnitCount", {
                units: row.availableUnits.toLocaleString(locale),
                buildings: row.availableBuildings.toLocaleString(locale)
              })}
            </span>
          </div>
          <div className="breakdown-track">
            <span style={{ width: `${row.percent}%` }} />
          </div>
        </div>
      ))}
      <div className="area-unit-summary">
        <strong>{rows.reduce((total, row) => total + row.availableUnits, 0).toLocaleString(locale)}</strong>
        <span>{t("dashboard.availableUnitsTotal")}</span>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  suffix,
  tone,
  trend,
  trendText,
  value
}: {
  icon?: React.ReactNode;
  label: string;
  suffix?: string;
  tone?: "brand" | "danger";
  trend?: "up" | "down";
  trendText: string;
  value: string;
}) {
  return (
    <article className={`metric-card latest-metric ${tone ?? ""}`}>
      <div className="metric-row">
        <span>{label}</span>
        {icon}
      </div>
      <div className="metric-value">
        {value}
        {suffix ? <span>{suffix}</span> : null}
      </div>
      <div className="metric-trend">
        {trend === "up" ? <ArrowUp size={13} /> : null}
        {trend === "down" ? <ArrowDown size={13} /> : null}
        {trendText}
      </div>
    </article>
  );
}

function ActivityBars({ buckets }: { buckets: TrendBucket[] }) {
  const maxValue = Math.max(1, ...buckets.flatMap((bucket) => [bucket.newListings, bucket.offMarket]));

  return (
    <div className="activity-bars">
      {buckets.map((bucket) => (
        <div className="activity-day" key={bucket.label}>
          <div className="activity-stack">
            <span className="new-bar" style={{ height: `${Math.max(8, (bucket.newListings / maxValue) * 100)}%` }} />
            <span className="off-bar" style={{ height: `${Math.max(8, (bucket.offMarket / maxValue) * 100)}%` }} />
          </div>
          <small>{bucket.label}</small>
        </div>
      ))}
    </div>
  );
}

type TrendBucket = {
  label: string;
  newListings: number;
  offMarket: number;
};

function buildTrendBuckets(listings: UnitListing[], locale: string): TrendBucket[] {
  return Array.from({ length: 14 }, (_item, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - index));
    date.setHours(0, 0, 0, 0);
    const nextDate = new Date(date);
    nextDate.setDate(date.getDate() + 1);
    const start = date.getTime();
    const end = nextDate.getTime();

    return {
      label: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date),
      newListings: listings.filter((listing) => {
        const listedAt = new Date(listing.listed_at).getTime();
        return listedAt >= start && listedAt < end;
      }).length,
      offMarket: listings.filter((listing) => {
        if (!listing.unavailable_at) {
          return false;
        }
        const unavailableAt = new Date(listing.unavailable_at).getTime();
        return unavailableAt >= start && unavailableAt < end;
      }).length
    };
  });
}

function buildAreaUnitStats(rows: AvailableUnitAreaRow[]): AreaUnitStat[] {
  const groups = new Map<string, { buildingIDs: Set<string>; unitIDs: Set<string> }>();

  rows.forEach((row) => {
    const unit = oneRelation(row.units);
    const building = oneRelation(unit?.buildings);
    const unitID = unit?.id ?? row.unit_id;
    const buildingID = building?.id ?? unit?.building_id;

    if (!unitID || !buildingID) {
      return;
    }

    const area = building?.area ?? building?.city ?? "Unknown";
    const group = groups.get(area) ?? { buildingIDs: new Set<string>(), unitIDs: new Set<string>() };
    group.buildingIDs.add(buildingID);
    group.unitIDs.add(unitID);
    groups.set(area, group);
  });

  const maxUnits = Math.max(1, ...Array.from(groups.values()).map((group) => group.unitIDs.size));

  return Array.from(groups.entries())
    .map(([area, group]) => ({
      area,
      availableBuildings: group.buildingIDs.size,
      availableUnits: group.unitIDs.size,
      percent: Math.max(8, (group.unitIDs.size / maxUnits) * 100)
    }))
    .sort((first, second) => second.availableUnits - first.availableUnits || first.area.localeCompare(second.area));
}

function buildAvailableUnitsByBuilding(rows: AvailableUnitAreaRow[]) {
  const counts = new Map<string, Set<string>>();

  rows.forEach((row) => {
    const unit = oneRelation(row.units);
    const building = oneRelation(unit?.buildings);
    const unitID = unit?.id ?? row.unit_id;
    const buildingID = building?.id ?? unit?.building_id;

    if (!unitID || !buildingID) {
      return;
    }

    const units = counts.get(buildingID) ?? new Set<string>();
    units.add(unitID);
    counts.set(buildingID, units);
  });

  return new Map(Array.from(counts.entries()).map(([buildingID, unitIDs]) => [buildingID, unitIDs.size]));
}

function countAvailableBuildings(rows: AvailableUnitAreaRow[]) {
  return buildAvailableUnitsByBuilding(rows).size;
}

function countAvailableUnits(rows: AvailableUnitAreaRow[]) {
  const unitIDs = new Set<string>();

  rows.forEach((row) => {
    const unit = oneRelation(row.units);
    const unitID = unit?.id ?? row.unit_id;

    if (unitID) {
      unitIDs.add(unitID);
    }
  });

  return unitIDs.size;
}

function oneRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
