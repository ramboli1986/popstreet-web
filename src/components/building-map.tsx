"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { buildingMapRegionFor, canonicalBuildingAreaLabel } from "@/lib/building-market-groups";
import type { Building } from "@/lib/types";

type BuildingMapProps = {
  buildings: Building[];
  selectedBuilding: Building | null;
  canEdit: boolean;
  areaColors?: Map<string, string>;
  resetSignal?: number;
  onSelect: (building: Building) => void;
  onCoordinateChange: (coordinate: { latitude: number; longitude: number }) => void;
};

export function BuildingMap({
  areaColors,
  buildings,
  selectedBuilding,
  canEdit,
  resetSignal = 0,
  onSelect,
  onCoordinateChange
}: BuildingMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markersRef = useRef<Leaflet.Marker[]>([]);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const boundsSignatureRef = useRef("");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function initMap() {
      if (!mapElementRef.current || mapRef.current) {
        return;
      }

      const L = await import("leaflet");

      if (!isMounted || !mapElementRef.current) {
        return;
      }

      leafletRef.current = L;
      const map = L.map(mapElementRef.current, {
        attributionControl: false,
        zoomControl: false,
        scrollWheelZoom: true
      }).setView([40.742, -74.0], 12);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        maxZoom: 19
      }).addTo(map);

      L.control
        .zoom({
          position: "topright"
        })
        .addTo(map);

      L.control
        .attribution({
          prefix: false
        })
        .addAttribution("© Mapbox © OpenStreetMap")
        .addTo(map);

      mapRef.current = map;
      setIsReady(true);
    }

    initMap();

    return () => {
      isMounted = false;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;

    if (!isReady || !L || !map) {
      return;
    }

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const validBuildings = buildings.filter(
      (building) => Number.isFinite(building.latitude) && Number.isFinite(building.longitude)
    );

    validBuildings.forEach((building) => {
      const isSelected = selectedBuilding?.id === building.id;
      const area = buildingArea(building);
      const mapRegion = buildingMapRegionFor(building);
      const markerColor = areaColors?.get(mapRegion.value) ?? areaMarkerColor(area);
      const marker = L.marker([building.latitude, building.longitude], {
        draggable: canEdit && isSelected,
        icon: L.divIcon({
          className: "",
          html: `<div class="${isSelected ? "map-building-pin map-building-pin-selected" : "map-building-pin"}" style="--marker-color: ${markerColor};" title="${escapeHtml(
            building.name
          )}" aria-label="${escapeHtml(building.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V8.6L12 4l7 4.6V20h-3.2v-7.1h-3V20h-1.6v-7.1h-3V20H5Zm2.2-2.2H9v-7.1h6v7.1h1.8V9.7L12 6.6 7.2 9.7v8.1Z"/></svg></div>`,
          iconAnchor: [16, 16]
        }),
        zIndexOffset: isSelected ? 1000 : 0
      });

      marker.on("click", () => onSelect(building));
      marker.on("dragend", () => {
        const nextLatLng = marker.getLatLng();
        onCoordinateChange({
          latitude: Number(nextLatLng.lat.toFixed(7)),
          longitude: Number(nextLatLng.lng.toFixed(7))
        });
      });
      marker.addTo(map);
      markersRef.current.push(marker);
    });

    const nextSignature = validBuildings.map((building) => building.id).join(",");
    if (validBuildings.length > 0 && nextSignature !== boundsSignatureRef.current) {
      boundsSignatureRef.current = nextSignature;
      const bounds = L.latLngBounds(validBuildings.map((building) => [building.latitude, building.longitude]));
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13 });
    }
  }, [areaColors, buildings, canEdit, isReady, onCoordinateChange, onSelect, selectedBuilding]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;

    if (!isReady || !L || !map) {
      return;
    }

    const validBuildings = buildings.filter(
      (building) => Number.isFinite(building.latitude) && Number.isFinite(building.longitude)
    );

    if (validBuildings.length === 0) {
      return;
    }

    const bounds = L.latLngBounds(validBuildings.map((building) => [building.latitude, building.longitude]));
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13 });
  }, [buildings, isReady, resetSignal]);

  return <div className="map-canvas" ref={mapElementRef} />;
}

function buildingArea(building: Building) {
  const rawArea = building.area || building.neighborhoods?.name || building.city || "Other";
  return canonicalBuildingAreaLabel(rawArea, building.city, building.state) || rawArea;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function areaMarkerColor(area: string) {
  const palette = [
    "#4285f4",
    "#34a853",
    "#fbbc04",
    "#ea4335",
    "#7e57c2",
    "#00acc1",
    "#f57c00",
    "#5c6bc0",
    "#43a047",
    "#d81b60"
  ];
  let hash = 0;

  for (let index = 0; index < area.length; index += 1) {
    hash = (hash * 31 + area.charCodeAt(index)) % palette.length;
  }

  return palette[Math.abs(hash) % palette.length];
}
