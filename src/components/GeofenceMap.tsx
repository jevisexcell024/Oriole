import { Fragment, useEffect } from "react";
import { MapContainer, TileLayer, LayersControl, LayerGroup, ScaleControl, Marker, Circle, CircleMarker, Tooltip, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import type { GeofenceCenter } from "@shared/types";

export interface LiveCandidateMarker {
  id: string;
  label: string;
  lat: number;
  lng: number;
  /** null = no fix yet / GPS error, rather than a confirmed inside/outside state. */
  inside: boolean | null;
}

// Vite serves Leaflet's default marker images as hashed URLs — the library's
// built-in icon lookup expects a static path, so it must be overridden once.
// `new URL(..., import.meta.url)` is Vite's asset-URL pattern and needs no
// image-module type declarations (unlike a static `import x from "*.png"`).
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL("leaflet/dist/images/marker-icon-2x.png", import.meta.url).href,
  iconUrl: new URL("leaflet/dist/images/marker-icon.png", import.meta.url).href,
  shadowUrl: new URL("leaflet/dist/images/marker-shadow.png", import.meta.url).href,
});

function ClickCatcher({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FitToCenters({ centers, candidates }: { centers: GeofenceCenter[]; candidates: LiveCandidateMarker[] }) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [
      ...centers.map((c) => [c.lat, c.lng] as [number, number]),
      ...candidates.map((c) => [c.lat, c.lng] as [number, number]),
    ];
    if (points.length === 0) return;
    if (points.length === 1) { map.setView(points[0], 18); return; }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    centers.map((c) => `${c.id}:${c.lat}:${c.lng}`).join("|"),
    candidates.map((c) => `${c.id}:${c.lat}:${c.lng}`).join("|"),
  ]);
  return null;
}

export function GeofenceMap({
  centers, onAddAt, onMove, candidates = [], onSelectCandidate,
}: {
  centers: GeofenceCenter[];
  onAddAt?: (lat: number, lng: number) => void;
  onMove?: (id: string, lat: number, lng: number) => void;
  /** Live candidate positions, for the admin live-monitor map (Phase 2). Omit for the exam-builder editor. */
  candidates?: LiveCandidateMarker[];
  onSelectCandidate?: (id: string) => void;
}) {
  const initial: [number, number] = centers[0] ? [centers[0].lat, centers[0].lng] : candidates[0] ? [candidates[0].lat, candidates[0].lng] : [5.6037, -0.187]; // Accra, a neutral default
  return (
    <MapContainer center={initial} zoom={centers[0] || candidates[0] ? 17 : 6} maxZoom={20} style={{ height: 340, width: "100%", borderRadius: 12 }}>
      <LayersControl position="topright">
        {/* Satellite (default) — actual rooftops/paths, so an approved area can be pinned
            against real buildings instead of guessed from a plain street outline. */}
        <LayersControl.BaseLayer checked name="Satellite">
          <LayerGroup>
            <TileLayer
              maxZoom={20}
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
            />
            {/* Street/building labels overlaid on the imagery, so it reads as a proper
                hybrid view rather than bare aerial photography. */}
            <TileLayer
              maxZoom={20}
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              attribution="Labels &copy; Esri"
            />
          </LayerGroup>
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Street">
          <TileLayer
            maxZoom={19}
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
        </LayersControl.BaseLayer>
      </LayersControl>
      <ScaleControl position="bottomleft" />
      {onAddAt && <ClickCatcher onClick={onAddAt} />}
      <FitToCenters centers={centers} candidates={candidates} />
      {centers.map((c) => (
        <Fragment key={c.id}>
          <Circle center={[c.lat, c.lng]} radius={c.radiusM} pathOptions={{ color: "#c6ff34", fillColor: "#c6ff34", fillOpacity: 0.15, weight: 2 }} />
          <Marker
            position={[c.lat, c.lng]}
            draggable={!!onMove}
            eventHandlers={onMove ? { dragend: (e) => { const p = e.target.getLatLng(); onMove(c.id, p.lat, p.lng); } } : undefined}
          />
        </Fragment>
      ))}
      {candidates.map((c) => {
        const color = c.inside === true ? "#22c55e" : c.inside === false ? "#f43f5e" : "#9ca3af";
        return (
          <CircleMarker
            key={c.id}
            center={[c.lat, c.lng]}
            radius={8}
            pathOptions={{ color, fillColor: color, fillOpacity: 0.85, weight: 2 }}
            eventHandlers={onSelectCandidate ? { click: () => onSelectCandidate(c.id) } : undefined}
          >
            <Tooltip direction="top" offset={[0, -8]}>{c.label} — {c.inside === true ? "Inside" : c.inside === false ? "Outside" : "No fix"}</Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
