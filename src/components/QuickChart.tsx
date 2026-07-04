/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo } from "react";
import { ChartDataPoint } from "../types";

interface QuickChartProps {
  data: ChartDataPoint[];
  yKey: "omega" | "ek";
  title: string;
  yUnit: string;
  color: string;
  gradientId: string;
}

export default function QuickChart({
  data,
  yKey,
  title,
  yUnit,
  color,
  gradientId,
}: QuickChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter out any invalid points
  const activeData = useMemo(() => {
    return data.filter((d) => !isNaN(d.time) && !isNaN(d[yKey]));
  }, [data, yKey]);

  // Dimensions
  const padding = { top: 20, right: 20, bottom: 35, left: 55 };
  const width = 420;
  const height = 180;

  // Compute min/max for scaling
  const bounds = useMemo(() => {
    if (activeData.length === 0) {
      return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    }

    const times = activeData.map((d) => d.time);
    const vals = activeData.map((d) => d[yKey]);

    const minX = 0; // Always start time from 0
    const maxX = Math.max(1, ...times);
    
    // Y-axis should start at 0
    const minY = 0;
    const maxVal = Math.max(...vals);
    const maxY = maxVal === 0 ? 1 : maxVal * 1.15; // 15% head room

    return { minX, maxX, minY, maxY };
  }, [activeData, yKey]);

  const { minX, maxX, minY, maxY } = bounds;

  // Coordinate mapping functions
  const getX = (time: number) => {
    const range = maxX - minX;
    const pct = range === 0 ? 0 : (time - minX) / range;
    return padding.left + pct * (width - padding.left - padding.right);
  };

  const getY = (val: number) => {
    const range = maxY - minY;
    const pct = range === 0 ? 0 : (val - minY) / range;
    // SVG y=0 is at the top, so invert
    return height - padding.bottom - pct * (height - padding.top - padding.bottom);
  };

  // Generate SVG Path
  const { pathData, areaData } = useMemo(() => {
    if (activeData.length === 0) return { pathData: "", areaData: "" };

    const points = activeData.map((d) => ({
      x: getX(d.time),
      y: getY(d[yKey]),
    }));

    // Build standard line path
    let dLine = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      dLine += ` L ${points[i].x} ${points[i].y}`;
    }

    // Build filled area path (closes at the bottom)
    const yBottom = height - padding.bottom;
    const dArea = `${dLine} L ${points[points.length - 1].x} ${yBottom} L ${points[0].x} ${yBottom} Z`;

    return { pathData: dLine, areaData: dArea };
  }, [activeData, minX, maxX, minY, maxY]);

  // Generate grid lines
  const gridLines = useMemo(() => {
    const lines = [];
    const numDivisions = 4;
    for (let i = 0; i <= numDivisions; i++) {
      const val = minY + (maxY - minY) * (i / numDivisions);
      const y = getY(val);
      lines.push({ val, y });
    }
    return lines;
  }, [minY, maxY]);

  const xGridLines = useMemo(() => {
    const lines = [];
    const numDivisions = 4;
    for (let i = 0; i <= numDivisions; i++) {
      const time = minX + (maxX - minX) * (i / numDivisions);
      const x = getX(time);
      lines.push({ time, x });
    }
    return lines;
  }, [minX, maxX]);

  // Handle Mouse Hover Tracker
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (activeData.length === 0 || !containerRef.current) return;

    const svgRect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - svgRect.left;

    // Convert mouseX back to SVG viewbox space
    const svgWidth = svgRect.width;
    const viewboxX = (mouseX / svgWidth) * width;

    // Find the closest point in data based on X coordinate
    let closestIndex = 0;
    let minDistance = Infinity;

    activeData.forEach((d, idx) => {
      const dx = Math.abs(getX(d.time) - viewboxX);
      if (dx < minDistance) {
        minDistance = dx;
        closestIndex = idx;
      }
    });

    setHoverIndex(closestIndex);
  };

  const activeHoverPoint = hoverIndex !== null && activeData[hoverIndex] ? activeData[hoverIndex] : null;

  return (
    <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-xs" ref={containerRef} id={`chart-container-${yKey}`}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-slate-700 font-display flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }}></span>
          {title}
        </h4>
        {activeHoverPoint ? (
          <span className="text-xs font-mono font-medium text-slate-500 bg-slate-50 px-2 py-0.5 rounded-sm">
            t: {activeHoverPoint.time.toFixed(2)}s | {activeHoverPoint[yKey].toFixed(3)} {yUnit}
          </span>
        ) : (
          <span className="text-xs font-mono text-slate-400">Realtime</span>
        )}
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
          id={`svg-chart-${yKey}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0.0} />
            </linearGradient>
          </defs>

          {/* Grid lines (horizontal) */}
          {gridLines.map((line, idx) => (
            <g key={`h-grid-${idx}`}>
              <line
                x1={padding.left}
                y1={line.y}
                x2={width - padding.right}
                y2={line.y}
                stroke="#f1f5f9"
                strokeWidth={1}
                strokeDasharray={idx === 0 ? "0" : "3,3"}
              />
              <text
                x={padding.left - 8}
                y={line.y + 4}
                textAnchor="end"
                className="fill-slate-400 font-mono text-[10px]"
              >
                {line.val.toFixed(yKey === "ek" ? 2 : 1)}
              </text>
            </g>
          ))}

          {/* X axis labels (vertical grid) */}
          {xGridLines.map((line, idx) => (
            <g key={`v-grid-${idx}`}>
              <line
                x1={line.x}
                y1={padding.top}
                x2={line.x}
                y2={height - padding.bottom}
                stroke="#f8fafc"
                strokeWidth={1}
              />
              <text
                x={line.x}
                y={height - padding.bottom + 16}
                textAnchor="middle"
                className="fill-slate-400 font-mono text-[10px]"
              >
                {line.time.toFixed(1)}s
              </text>
            </g>
          ))}

          {/* Area fill under curve */}
          {areaData && (
            <path d={areaData} fill={`url(#${gradientId})`} />
          )}

          {/* The line itself */}
          {pathData && (
            <path
              d={pathData}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Origin axes lines */}
          <line
            x1={padding.left}
            y1={height - padding.bottom}
            x2={width - padding.right}
            y2={height - padding.bottom}
            stroke="#cbd5e1"
            strokeWidth={1.5}
          />
          <line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={height - padding.bottom}
            stroke="#cbd5e1"
            strokeWidth={1.5}
          />

          {/* Axis Labels */}
          <text
            x={width / 2}
            y={height - 2}
            textAnchor="middle"
            className="fill-slate-500 font-sans text-[10px] font-medium"
          >
            Waktu (detik)
          </text>

          {/* Hover tracker elements */}
          {activeHoverPoint && (
            <g>
              {/* Vertical dotted guide line */}
              <line
                x1={getX(activeHoverPoint.time)}
                y1={padding.top}
                x2={getX(activeHoverPoint.time)}
                y2={height - padding.bottom}
                stroke="#64748b"
                strokeWidth={1.5}
                strokeDasharray="4,4"
              />

              {/* Glowing anchor point */}
              <circle
                cx={getX(activeHoverPoint.time)}
                cy={getY(activeHoverPoint[yKey])}
                r={6}
                fill={color}
                stroke="#ffffff"
                strokeWidth={2}
                className="shadow-md"
              />
              <circle
                cx={getX(activeHoverPoint.time)}
                cy={getY(activeHoverPoint[yKey])}
                r={10}
                fill={color}
                fillOpacity={0.2}
              />
            </g>
          )}
        </svg>

        {/* Empty state overlay */}
        {activeData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <span className="text-xs font-medium text-slate-400 font-sans">
              Menunggu data simulasi...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
