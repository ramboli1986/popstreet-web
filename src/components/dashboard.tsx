"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Building2, CircleSlash, DollarSign, RefreshCcw, Sparkles, Tag } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate, formatMoneyFromCents } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Building, UnitListing } from "@/lib/types";

type DashboardDeal = Pick<
  UnitListing,
  "id" | "market_price_cents" | "net_price_cents" | "cash_back_cents" | "free_months" | "lease_deal" | "updated_at"
> & {
  units: {
    id: string;
    unit_number: string;
    bedroom_count: number;
    bathroom_count: number;
    sqft: number | null;
    buildings: {
      id: string;
      name: string;
      area: string | null;
      city: string;
      state: string;
    } | null;
  } | null;
};

export function Dashboard() {
  const { language, t } = useI18n();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingCount, setBuildingCount] = useState(0);
  const [activeBuildingCount, setActiveBuildingCount] = useState(0);
  const [unitsCount, setUnitsCount] = useState(0);
  const [listings, setListings] = useState<UnitListing[]>([]);
  const [topDeals, setTopDeals] = useState<DashboardDeal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard() {
    setIsLoading(true);
    setError(null);

    const [
      buildingResult,
      buildingCountResult,
      activeBuildingCountResult,
      unitResult,
      listingResult,
      topDealsResult
    ] = await Promise.all([
      supabase
        .from("buildings")
        .select("*, neighborhoods(name, slug)")
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase.from("buildings").select("id", { count: "exact", head: true }),
      supabase.from("buildings").select("id", { count: "exact", head: true }).eq("is_active", true),
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
            "market_price_cents",
            "net_price_cents",
            "cash_back_cents",
            "free_months",
            "lease_deal",
            "updated_at",
            "units(id, unit_number, bedroom_count, bathroom_count, sqft, buildings(id, name, area, city, state))"
          ].join(",")
        )
        .eq("status", "available")
        .order("net_price_cents", { ascending: true })
        .limit(10)
    ]);

    if (
      buildingResult.error ||
      buildingCountResult.error ||
      activeBuildingCountResult.error ||
      unitResult.error ||
      listingResult.error ||
      topDealsResult.error
    ) {
      setError(
        buildingResult.error?.message ??
          buildingCountResult.error?.message ??
          activeBuildingCountResult.error?.message ??
          unitResult.error?.message ??
          listingResult.error?.message ??
          topDealsResult.error?.message ??
          "Load failed"
      );
    } else {
      setBuildings((buildingResult.data ?? []) as Building[]);
      setBuildingCount(buildingCountResult.count ?? 0);
      setActiveBuildingCount(activeBuildingCountResult.count ?? 0);
      setUnitsCount(unitResult.count ?? 0);
      setListings((listingResult.data ?? []) as UnitListing[]);
      setTopDeals((topDealsResult.data ?? []) as unknown as DashboardDeal[]);
    }

    setIsLoading(false);
  }

  useEffect(() => {
    loadDashboard();
  }, []);

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
      activeBuildings: activeBuildingCount,
      totalUnits: unitsCount,
      availableListings: availableListings.length,
      minNetPrice,
      medianNetPrice,
      newToday: listings.filter((listing) => new Date(listing.listed_at).getTime() >= todayTime).length,
      offMarketToday: listings.filter(
        (listing) => listing.unavailable_at && new Date(listing.unavailable_at).getTime() >= todayTime
      ).length
    };
  }, [activeBuildingCount, buildingCount, listings, unitsCount]);

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const trendBuckets = useMemo(() => buildTrendBuckets(listings, locale), [listings, locale]);
  const areaBreakdown = useMemo(() => buildAreaBreakdown(topDeals), [topDeals]);

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

        <article className="analytics-card top-deals-card">
          <div className="card-heading">
            <div>
              <div className="eyebrow">{t("dashboard.hot")}</div>
              <h3>{t("dashboard.topDealsNow")}</h3>
            </div>
            <span className="count-pill">{t("dashboard.live")}</span>
          </div>

          <div className="top-deal-list">
            {topDeals.map((deal) => (
              <TopDealRow deal={deal} key={deal.id} t={t} />
            ))}
          </div>
        </article>
      </section>

      <section className="dashboard-secondary-grid">
        <article className="analytics-card">
          <div className="card-heading">
            <div>
              <div className="eyebrow">{t("dashboard.recentlyUpdated")}</div>
              <h3>{t("common.buildings")}</h3>
            </div>
            <span className="count-pill">{t("dashboard.latest", { count: buildings.length.toLocaleString(locale) })}</span>
          </div>

          <div className="recent-building-list">
            {buildings.map((building) => (
              <div className="recent-building-row" key={building.id}>
                <div>
                  <strong>{building.name}</strong>
                  <p className="muted">
                    {building.area ?? building.neighborhoods?.name ?? building.city}, {building.state}
                  </p>
                </div>
                <span className={`status-pill ${building.is_active ? "active" : "suspended"}`}>
                  {building.is_active ? t("common.active") : t("common.archived")}
                </span>
                <span className="muted">{formatDate(building.updated_at)}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="analytics-card">
          <div className="card-heading">
            <div>
              <div className="eyebrow">{t("dashboard.neighborhoodMix")}</div>
              <h3>{t("dashboard.dealConcentration")}</h3>
            </div>
            <span className="count-pill">{t("dashboard.topDeals")}</span>
          </div>
          <div className="breakdown-list">
            {areaBreakdown.map((row) => (
              <div className="breakdown-row" key={row.area}>
                <div>
                  <strong>{row.area}</strong>
                  <span>{t("dashboard.dealCount", { count: row.count.toLocaleString(locale) })}</span>
                </div>
                <div className="breakdown-track">
                  <span style={{ width: `${row.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

type Translate = (key: string, params?: Record<string, number | string>) => string;

function TopDealRow({ deal, t }: { deal: DashboardDeal; t: Translate }) {
  const unit = deal.units;
  const building = unit?.buildings;
  const discountPercent =
    deal.market_price_cents && deal.market_price_cents > deal.net_price_cents
      ? Math.round(((deal.market_price_cents - deal.net_price_cents) / deal.market_price_cents) * 100)
      : null;
  const layout = unit
    ? `${unit.bedroom_count === 0 ? t("dashboard.studio") : `${unit.bedroom_count} ${t("dashboard.bedShort")}`} / ${
        unit.bathroom_count
      } ${t("dashboard.bathShort")}${unit.sqft ? ` / ${unit.sqft.toLocaleString()} ${t("dashboard.sqft")}` : ""}`
    : t("dashboard.layoutMissing");

  const defaultDealLabel = t("dashboard.monthsFreeShort", {
    count: deal.free_months.toLocaleString()
  });

  const cashbackLabel =
    deal.cash_back_cents > 0 ? ` · ${formatMoneyFromCents(deal.cash_back_cents)} ${t("common.back")}` : "";

  return (
    <div className="top-deal-row">
      <span className="deal-rank" />
      <div>
        <strong>{building?.name ?? t("dashboard.unknownBuilding")}</strong>
        <p className="muted">
          {t("common.unit")} {unit?.unit_number ?? t("common.na")} ·{" "}
          {building ? `${building.area ?? building.city}, ${building.state}` : t("dashboard.noLocation")}
        </p>
      </div>
      <div className="deal-layout">{layout}</div>
      <div className="deal-price">
        <strong>{formatMoneyFromCents(deal.net_price_cents)}</strong>
        <span>
          {deal.market_price_cents
            ? `${formatMoneyFromCents(deal.market_price_cents)} ${t("common.market")}`
            : t("dashboard.noMarketPrice")}
        </span>
      </div>
      <div className="deal-chip">
        {deal.lease_deal || defaultDealLabel}
        {cashbackLabel}
      </div>
      <div className="deal-meta">
        {discountPercent == null ? t("common.na") : t("dashboard.percentOff", { percent: discountPercent })}
        <span>{formatDate(deal.updated_at)}</span>
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

function buildAreaBreakdown(deals: DashboardDeal[]) {
  const counts = new Map<string, number>();

  deals.forEach((deal) => {
    const building = deal.units?.buildings;
    const area = building?.area ?? building?.city ?? "Unknown";
    counts.set(area, (counts.get(area) ?? 0) + 1);
  });

  const maxCount = Math.max(1, ...counts.values());

  return Array.from(counts.entries())
    .map(([area, count]) => ({
      area,
      count,
      percent: Math.max(8, (count / maxCount) * 100)
    }))
    .sort((first, second) => second.count - first.count)
    .slice(0, 8);
}
