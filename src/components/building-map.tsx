"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { Building } from "@/lib/types";

type BuildingMapProps = {
  buildings: Building[];
  selectedBuilding: Building | null;
  canEdit: boolean;
  onSelect: (building: Building) => void;
  onCoordinateChange: (coordinate: { latitude: number; longitude: number }) => void;
};

export function BuildingMap({
  buildings,
  selectedBuilding,
  canEdit,
  onSelect,
  onCoordinateChange
}: BuildingMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markersRef = useRef<Leaflet.Marker[]>([]);
  const leafletRef = useRef<typeof Leaflet | null>(null);
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
        zoomControl: true,
        scrollWheelZoom: true
      }).setView([40.742, -74.0], 12);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        maxZoom: 19
      }).addTo(map);

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
      const markerColor = areaMarkerColor(building.area || building.neighborhoods?.name || building.city || "Other");
      const marker = L.marker([building.latitude, building.longitude], {
        draggable: canEdit && isSelected,
        icon: L.divIcon({
          className: "",
          html: `<div class="${isSelected ? "building-marker building-marker-selected" : "building-marker"}" style="--marker-color: ${markerColor};">${escapeHtml(
            building.name
          )}</div>`,
          iconAnchor: [20, 18]
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

    if (selectedBuilding) {
      map.setView([selectedBuilding.latitude, selectedBuilding.longitude], Math.max(map.getZoom(), 14), {
        animate: true
      });
      return;
    }

    if (validBuildings.length > 0) {
      const bounds = L.latLngBounds(validBuildings.map((building) => [building.latitude, building.longitude]));
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    }
  }, [buildings, canEdit, isReady, onCoordinateChange, onSelect, selectedBuilding]);

  return <div className="map-canvas" ref={mapElementRef} />;
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
