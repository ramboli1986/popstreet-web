"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, CircleDollarSign, DoorOpen, RefreshCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate, formatMoneyFromCents } from "@/lib/format";
import type { Building, BuildingStats, UnitListing } from "@/lib/types";

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

  const stats: BuildingStats = useMemo(() => {
    const availableListings = listings.filter((listing) => listing.status === "available");
    const minNetPrice = availableListings.reduce<number | null>((min, listing) => {
      if (listing.net_price_cents == null) {
        return min;
      }

      return min == null ? listing.net_price_cents : Math.min(min, listing.net_price_cents);
    }, null);

    return {
      totalBuildings: buildingCount,
      activeBuildings: activeBuildingCount,
      totalUnits: unitsCount,
      availableListings: availableListings.length,
      minNetPrice
    };
  }, [activeBuildingCount, buildingCount, listings, unitsCount]);

  return (
    <>
      <div className="content-header">
        <div>
          <div className="eyebrow">Overview</div>
          <h2>Building health</h2>
        </div>
        <button className="ghost-button" disabled={isLoading} onClick={loadDashboard} type="button">
          <RefreshCcw size={16} />
          Refresh
        </button>
      </div>

      {error ? <div className="message error">{error}</div> : null}

      <section className="grid-4">
        <MetricCard icon={<Building2 size={18} />} label="Total buildings" value={stats.totalBuildings.toString()} />
        <MetricCard label="Active buildings" value={stats.activeBuildings.toString()} />
        <MetricCard icon={<DoorOpen size={18} />} label="Total units" value={stats.totalUnits.toString()} />
        <MetricCard
          icon={<CircleDollarSign size={18} />}
          label="Lowest net rent"
          value={formatMoneyFromCents(stats.minNetPrice)}
        />
      </section>

      <section className="dashboard-grid" style={{ marginTop: 18 }}>
        <div className="panel">
          <div className="section-title">
            <div>
              <div className="eyebrow">Top deals</div>
              <h3>Lowest available net rents</h3>
            </div>
            <span className="count-pill">Live from Supabase</span>
          </div>

          <div className="deal-list">
            {topDeals.map((deal) => (
              <TopDealRow deal={deal} key={deal.id} />
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="section-title">
            <div>
              <div className="eyebrow">Recently updated</div>
              <h3>Buildings</h3>
            </div>
            <span className="count-pill">{stats.availableListings} available listings</span>
          </div>

          <div className="accounts-list compact-list">
            {buildings.map((building) => (
              <div className="account-row dashboard-building-row" key={building.id}>
                <div>
                  <strong>{building.name}</strong>
                  <p className="muted">
                    {building.area ?? building.neighborhoods?.name ?? building.city}, {building.state}
                  </p>
                </div>
                <span className={`status-pill ${building.is_active ? "active" : "suspended"}`}>
                  {building.is_active ? "Active" : "Archived"}
                </span>
                <span className="muted">{formatDate(building.updated_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function TopDealRow({ deal }: { deal: DashboardDeal }) {
  const unit = deal.units;
  const building = unit?.buildings;
  const discountPercent =
    deal.market_price_cents && deal.market_price_cents > deal.net_price_cents
      ? Math.round(((deal.market_price_cents - deal.net_price_cents) / deal.market_price_cents) * 100)
      : null;
  const layout = unit
    ? `${unit.bedroom_count === 0 ? "Studio" : `${unit.bedroom_count} bd`} / ${unit.bathroom_count} ba${
        unit.sqft ? ` / ${unit.sqft.toLocaleString()} sqft` : ""
      }`
    : "Layout missing";

  return (
    <div className="deal-row">
      <div>
        <strong>{building?.name ?? "Unknown building"}</strong>
        <p className="muted">
          Unit {unit?.unit_number ?? "N/A"} · {building ? `${building.area ?? building.city}, ${building.state}` : "No location"}
        </p>
      </div>
      <div className="deal-layout">{layout}</div>
      <div className="deal-price">
        <strong>{formatMoneyFromCents(deal.net_price_cents)}</strong>
        <span>{deal.market_price_cents ? `${formatMoneyFromCents(deal.market_price_cents)} market` : "No market price"}</span>
      </div>
      <div className="deal-chip">
        {deal.lease_deal || `${deal.free_months.toLocaleString()} mo free`}
        {deal.cash_back_cents > 0 ? ` · ${formatMoneyFromCents(deal.cash_back_cents)} back` : ""}
      </div>
      <div className="deal-meta">
        {discountPercent == null ? "N/A" : `${discountPercent}% off`}
        <span>{formatDate(deal.updated_at)}</span>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <article className="metric-card">
      <div className="metric-row">
        <span className="muted">{label}</span>
        {icon}
      </div>
      <div className="metric-value">{value}</div>
    </article>
  );
}
