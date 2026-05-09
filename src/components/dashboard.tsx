"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, CircleDollarSign, DoorOpen, RefreshCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate, formatMoneyFromCents } from "@/lib/format";
import type { Building, BuildingStats, UnitListing } from "@/lib/types";

export function Dashboard() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingCount, setBuildingCount] = useState(0);
  const [activeBuildingCount, setActiveBuildingCount] = useState(0);
  const [unitsCount, setUnitsCount] = useState(0);
  const [listings, setListings] = useState<UnitListing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard() {
    setIsLoading(true);
    setError(null);

    const [buildingResult, buildingCountResult, activeBuildingCountResult, unitResult, listingResult] = await Promise.all([
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
        .limit(500)
    ]);

    if (
      buildingResult.error ||
      buildingCountResult.error ||
      activeBuildingCountResult.error ||
      unitResult.error ||
      listingResult.error
    ) {
      setError(
        buildingResult.error?.message ??
          buildingCountResult.error?.message ??
          activeBuildingCountResult.error?.message ??
          unitResult.error?.message ??
          listingResult.error?.message ??
          "Load failed"
      );
    } else {
      setBuildings((buildingResult.data ?? []) as Building[]);
      setBuildingCount(buildingCountResult.count ?? 0);
      setActiveBuildingCount(activeBuildingCountResult.count ?? 0);
      setUnitsCount(unitResult.count ?? 0);
      setListings((listingResult.data ?? []) as UnitListing[]);
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
          <h2>Inventory health</h2>
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

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="section-title">
          <div>
            <div className="eyebrow">Recently updated</div>
            <h3>Buildings</h3>
          </div>
          <span className="count-pill">{stats.availableListings} available listings</span>
        </div>

        <div className="accounts-list">
          {buildings.map((building) => (
            <div className="account-row" key={building.id}>
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
              <span className="muted">
                {building.latitude.toFixed(4)}, {building.longitude.toFixed(4)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
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
