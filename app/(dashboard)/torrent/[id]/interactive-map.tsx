"use client";

import { useState, memo } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Line,
  ZoomableGroup,
} from "react-simple-maps";

const mapUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const InteractiveMap = memo(function InteractiveMap({
  peerSnapshots,
  localCoord,
}: {
  peerSnapshots: {
    id: string;
    ip: string;
    coordinates: [number, number];
    downloadMbps: number;
    uploadMbps: number;
  }[];
  localCoord: [number, number];
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  return (
    <div className="relative w-full h-full bg-card overflow-hidden">
      <style dangerouslySetInnerHTML={{__html: `
        .flow-line { stroke-dasharray: 6; animation: dash 2s linear infinite; }
        @keyframes dash { to { stroke-dashoffset: -12; } }
      `}} />
      <ComposableMap projection="geoMercator" projectionConfig={{ scale: 120, center: [0, 20] }} className="w-full h-full">
        <ZoomableGroup zoom={1} minZoom={1} maxZoom={8}>
          <Geographies geography={mapUrl}>
            {({ geographies }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="hsl(var(--secondary))"
                  stroke="hsl(var(--border))"
                  strokeWidth={0.5}
                  className="opacity-40 outline-none"
                  style={{
                    default: { outline: "none" },
                    hover: { fill: "hsl(var(--secondary))", outline: "none" },
                    pressed: { outline: "none" },
                  }}
                />
              ))
            }
          </Geographies>

          {peerSnapshots.map((peer, i) => (
            <Line
              key={`line-${peer.id}`}
              from={localCoord}
              to={peer.coordinates}
              stroke={`hsl(var(--${i % 2 === 0 ? 'primary' : 'accent'}))`}
              strokeWidth={1.5}
              strokeLinecap="round"
              className="flow-line opacity-60 pointer-events-none"
            />
          ))}

          <Marker 
            coordinates={localCoord}
            onMouseEnter={(e) => {
              setTooltip({ x: e.clientX, y: e.clientY - 40, text: "Local Client" });
            }}
            onMouseLeave={() => setTooltip(null)}
          >
             <circle r={6} fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth={2} className="cursor-pointer" />
             <circle r={14} fill="hsl(var(--foreground))" opacity={0.1} className="animate-ping pointer-events-none" />
          </Marker>

          {peerSnapshots.map((peer, i) => (
            <Marker 
              key={peer.id} 
              coordinates={peer.coordinates}
              onMouseEnter={(e) => {
                setTooltip({ 
                  x: e.clientX, 
                  y: e.clientY - 40, 
                  text: `Node: ${peer.id}\nIP: ${peer.ip}\nSpeed: ↓${peer.downloadMbps} / ↑${peer.uploadMbps}` 
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              <circle r={4} fill={`hsl(var(--${i % 2 === 0 ? 'primary' : 'accent'}))`} className="cursor-pointer" />
            </Marker>
          ))}
        </ZoomableGroup>
      </ComposableMap>
      
      {tooltip && (
        <div 
          className="fixed z-50 rounded-md bg-foreground text-background text-xs px-3 py-2 whitespace-pre shadow-lg pointer-events-none transition-opacity"
          style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-50%, -100%)" }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
});

export default InteractiveMap;
