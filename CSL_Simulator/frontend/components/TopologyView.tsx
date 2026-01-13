"use client";

import React, { useState } from "react";
import { SimConfig } from "../app/api";
import { ZoomIn, ZoomOut, Move } from "lucide-react";

interface TopologyViewProps {
    config: SimConfig;
    onSelectComponent: (section: "intake" | "engine" | "exhaust", subpath?: string) => void;
}

const TopologyView: React.FC<TopologyViewProps> = ({ config, onSelectComponent }) => {
    const [zoom, setZoom] = useState(1.0);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [hoveredPart, setHoveredPart] = useState<string | null>(null);

    // SVG Constants for Drawing
    const CYLINDER_SPACING = 100;
    const ENGINE_START_X = 300;
    const ENGINE_Y = 200;
    const PLENUM_Y = 50;
    const EXHAUST_START_Y = 350;

    // Helper to generate path for curved pipes
    const generateSPath = (x1: number, y1: number, x2: number, y2: number) => {
        const midY = (y1 + y2) / 2;
        return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
    };

    return (
        <div className="w-full h-[600px] bg-slate-950 border border-slate-800 rounded-xl relative overflow-hidden group">

            {/* Controls */}
            <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
                <button onClick={() => setZoom(z => Math.min(z + 0.1, 2.0))} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 text-slate-300"><ZoomIn size={16} /></button>
                <button onClick={() => setZoom(z => Math.max(z - 0.1, 0.5))} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 text-slate-300"><ZoomOut size={16} /></button>
                <button onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }) }} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 text-slate-300"><Move size={16} /></button>
            </div>

            {/* Info Overlay */}
            {hoveredPart && (
                <div className="absolute top-4 left-4 bg-slate-900/90 border border-ember-500/50 p-3 rounded-lg backdrop-blur-sm z-10 pointer-events-none animate-in fade-in slide-in-from-top-2">
                    <h3 className="text-ember-400 font-bold text-sm uppercase tracking-wider">{hoveredPart.split('|')[0]}</h3>
                    <div className="text-xs text-slate-400 mt-1 font-mono">
                        {hoveredPart.split('|')[1]}
                    </div>
                </div>
            )}

            <svg
                className="w-full h-full cursor-grab active:cursor-grabbing"
                viewBox="0 0 1200 600"
                style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`, transformOrigin: "center" }}
            >
                <defs>
                    <linearGradient id="intakeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.2" />
                    </linearGradient>
                    <linearGradient id="exhaustGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.2" />
                    </linearGradient>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5" />
                    </pattern>
                </defs>

                <rect width="100%" height="100%" fill="url(#grid)" />

                {/* --- INTAKE SYSTEM --- */}

                {/* Plenum Box */}
                <g
                    onClick={() => onSelectComponent("intake")}
                    onMouseEnter={() => setHoveredPart(`Plenum|Vol: ${config.intake.plenum_vol}L`)}
                    onMouseLeave={() => setHoveredPart(null)}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                >
                    <rect x={ENGINE_START_X - 50} y={PLENUM_Y} width={600} height={80} rx={10} fill="#1e293b" stroke="#0ea5e9" strokeWidth="2" />
                    <text x={ENGINE_START_X + 250} y={PLENUM_Y + 45} textAnchor="middle" fill="#0ea5e9" className="text-xs font-bold uppercase tracking-widest">Carbon Plenum</text>
                </g>

                {/* 6 Individual Intake Runners with optional ITBs */}
                {Array.from({ length: 6 }).map((_, i) => {
                    const cx = ENGINE_START_X + i * CYLINDER_SPACING;
                    return (
                        <g key={`runner-${i}`}
                            onClick={() => onSelectComponent("intake")}
                            onMouseEnter={() => setHoveredPart(`Cyl ${i + 1} Runner|L: ${config.intake.bellmouth.length}mm, D: ${config.intake.bellmouth.diameter}mm`)}
                            onMouseLeave={() => setHoveredPart(null)}
                            className="cursor-pointer hover:opacity-80"
                        >
                            {/* Runner Pipe */}
                            <path d={`M ${cx + 40} ${PLENUM_Y + 80} L ${cx + 40} ${ENGINE_Y}`} stroke="url(#intakeGrad)" strokeWidth={config.intake.bellmouth.diameter / 2} fill="none" />
                            {/* Bellmouth Flare */}
                            <path d={`M ${cx + 25} ${PLENUM_Y + 80} Q ${cx + 15} ${PLENUM_Y + 70}, ${cx + 10} ${PLENUM_Y + 60}`} stroke="#0ea5e9" strokeWidth="2" fill="none" />
                            <path d={`M ${cx + 55} ${PLENUM_Y + 80} Q ${cx + 65} ${PLENUM_Y + 70}, ${cx + 70} ${PLENUM_Y + 60}`} stroke="#0ea5e9" strokeWidth="2" fill="none" />

                            {/* ITB Graphic */}
                            {config.intake.itb.fitted && (
                                <rect x={cx + 20} y={PLENUM_Y + 100} width={40} height={20} fill="#eab308" stroke="#a16207" strokeWidth="2" rx={2} />
                            )}
                        </g>
                    );
                })}


                {/* --- ENGINE BLOCK --- */}
                <rect x={ENGINE_START_X - 20} y={ENGINE_Y} width={540} height={120} fill="#334155" stroke="#475569" strokeWidth="2" rx={5} />
                <text x={ENGINE_START_X + 250} y={ENGINE_Y + 65} textAnchor="middle" fill="#94a3b8" className="text-xs font-bold font-mono opacity-50">S54 BLOCK INLINE-6</text>

                {/* 6 Cylinders */}
                {Array.from({ length: 6 }).map((_, i) => {
                    const cx = ENGINE_START_X + i * CYLINDER_SPACING;
                    return (
                        <g key={`cyl-${i}`}
                            onClick={() => onSelectComponent("engine")}
                            onMouseEnter={() => setHoveredPart(`Cylinder ${i + 1}|Bore: ${config.engine.geometry.bore}mm, Wall: ${config.engine.head.wall_temp}K`)}
                            onMouseLeave={() => setHoveredPart(null)}
                            className="cursor-pointer hover:opacity-80"
                        >
                            <circle cx={cx + 40} cy={ENGINE_Y + 60} r={35} stroke="#cbd5e1" strokeWidth="2" fill="none" strokeDasharray="4 2" />
                            <text x={cx + 40} y={ENGINE_Y + 65} textAnchor="middle" fill="#cbd5e1" className="text-[10px] font-mono">{i + 1}</text>
                        </g>
                    );
                })}


                {/* --- EXHAUST SYSTEM --- */}

                {/* 6 Headers (Primaries) */}
                {Array.from({ length: 6 }).map((_, i) => {
                    const cx = ENGINE_START_X + i * CYLINDER_SPACING;
                    // Group 1-3 go to Collector 1, 4-6 to Collector 2
                    const collectorX = i < 3 ? ENGINE_START_X + 100 : ENGINE_START_X + 400;
                    const collectorY = EXHAUST_START_Y + 50;

                    return (
                        <g key={`header-${i}`}
                            onClick={() => onSelectComponent("exhaust")}
                            onMouseEnter={() => setHoveredPart(`Primary ${i + 1}|L: ${config.exhaust.headers.primary_length}mm, D: ${config.exhaust.headers.primary_diameter}mm`)}
                            onMouseLeave={() => setHoveredPart(null)}
                            className="cursor-pointer hover:opacity-80"
                        >
                            <path
                                d={generateSPath(cx + 40, ENGINE_Y + 120, collectorX, collectorY)}
                                stroke="url(#exhaustGrad)"
                                strokeWidth={config.exhaust.headers.primary_diameter / 3}
                                fill="none"
                                className="opacity-80"
                            />
                        </g>
                    );
                })}

                {/* Collectors */}
                <g onClick={() => onSelectComponent("exhaust")} className="cursor-pointer">
                    <circle cx={ENGINE_START_X + 100} cy={EXHAUST_START_Y + 50} r={25} fill="#f43f5e" className="animate-pulse opacity-50" />
                    <circle cx={ENGINE_START_X + 400} cy={EXHAUST_START_Y + 50} r={25} fill="#f43f5e" className="animate-pulse opacity-50" />
                </g>

                {/* Section 1 (Flexible Layout) */}
                <g
                    onClick={() => onSelectComponent("exhaust")}
                    onMouseEnter={() => setHoveredPart(`Section 1|${config.exhaust.section1.layout}, Cats: ${config.exhaust.section1.cat_fitted ? "Yes" : "No"}`)}
                    onMouseLeave={() => setHoveredPart(null)}
                >
                    {config.exhaust.section1.layout === "Straight" && (
                        <>
                            {/* Parallel Pipes */}
                            <path d={`M ${ENGINE_START_X + 100} ${EXHAUST_START_Y + 50} L ${ENGINE_START_X + 150} ${EXHAUST_START_Y + 200}`} stroke="#f43f5e" strokeWidth="15" />
                            <path d={`M ${ENGINE_START_X + 400} ${EXHAUST_START_Y + 50} L ${ENGINE_START_X + 350} ${EXHAUST_START_Y + 200}`} stroke="#f43f5e" strokeWidth="15" />
                        </>
                    )}

                    {config.exhaust.section1.layout === "X-Pipe" && (
                        <>
                            {/* Cross Over */}
                            <path d={`M ${ENGINE_START_X + 100} ${EXHAUST_START_Y + 50} L ${ENGINE_START_X + 150} ${EXHAUST_START_Y + 150}`} stroke="#f43f5e" strokeWidth="15" />
                            <path d={`M ${ENGINE_START_X + 400} ${EXHAUST_START_Y + 50} L ${ENGINE_START_X + 350} ${EXHAUST_START_Y + 150}`} stroke="#f43f5e" strokeWidth="15" />
                            {/* X-Merge at Center */}
                            <circle cx={ENGINE_START_X + 250} cy={EXHAUST_START_Y + 150} r={30} fill="#be123c" />
                            <text x={ENGINE_START_X + 250} y={EXHAUST_START_Y + 155} textAnchor="middle" fill="white" className="text-[10px] font-bold">X-PIPE</text>
                            {/* Exit from X */}
                            <path d={`M ${ENGINE_START_X + 150} ${EXHAUST_START_Y + 150} L ${ENGINE_START_X + 150} ${EXHAUST_START_Y + 200}`} stroke="#f43f5e" strokeWidth="15" />
                            <path d={`M ${ENGINE_START_X + 350} ${EXHAUST_START_Y + 150} L ${ENGINE_START_X + 350} ${EXHAUST_START_Y + 200}`} stroke="#f43f5e" strokeWidth="15" />
                        </>
                    )}

                    {config.exhaust.section1.layout === "H-Pipe" && (
                        <>
                            {/* Parallel with Bridge */}
                            <path d={`M ${ENGINE_START_X + 100} ${EXHAUST_START_Y + 50} L ${ENGINE_START_X + 150} ${EXHAUST_START_Y + 200}`} stroke="#f43f5e" strokeWidth="15" />
                            <path d={`M ${ENGINE_START_X + 400} ${EXHAUST_START_Y + 50} L ${ENGINE_START_X + 350} ${EXHAUST_START_Y + 200}`} stroke="#f43f5e" strokeWidth="15" />
                            {/* Bridge */}
                            <line x1={ENGINE_START_X + 125} y1={EXHAUST_START_Y + 125} x2={ENGINE_START_X + 375} y2={EXHAUST_START_Y + 125} stroke="#be123c" strokeWidth="12" />
                            <text x={ENGINE_START_X + 250} y={EXHAUST_START_Y + 140} textAnchor="middle" fill="white" className="text-[10px] font-bold">H-PIPE</text>
                        </>
                    )}

                    {config.exhaust.section1.layout === "Merge 2-into-1" && (
                        <>
                            {/* Y-Merge */}
                            <path d={`M ${ENGINE_START_X + 100} ${EXHAUST_START_Y + 50} L ${ENGINE_START_X + 250} ${EXHAUST_START_Y + 150}`} stroke="#f43f5e" strokeWidth="15" />
                            <path d={`M ${ENGINE_START_X + 400} ${EXHAUST_START_Y + 50} L ${ENGINE_START_X + 250} ${EXHAUST_START_Y + 150}`} stroke="#f43f5e" strokeWidth="15" />
                            <circle cx={ENGINE_START_X + 250} cy={EXHAUST_START_Y + 150} r={35} fill="#be123c" />
                            {/* Single Exit */}
                            <path d={`M ${ENGINE_START_X + 250} ${EXHAUST_START_Y + 150} L ${ENGINE_START_X + 250} ${EXHAUST_START_Y + 200}`} stroke="#f43f5e" strokeWidth="20" />
                        </>
                    )}

                    {/* Cats Rendering (Overlay) */}
                    {config.exhaust.section1.cat_fitted && (
                        <>
                            <rect x={ENGINE_START_X + 100} y={EXHAUST_START_Y + 60} width={40} height={40} rx={5} fill="#fbbf24" stroke="#d97706" />
                            <rect x={ENGINE_START_X + 370} y={EXHAUST_START_Y + 60} width={40} height={40} rx={5} fill="#fbbf24" stroke="#d97706" />
                            <text x={ENGINE_START_X + 120} y={EXHAUST_START_Y + 85} textAnchor="middle" className="text-[8px] font-bold" fill="#78350f">CAT</text>
                            <text x={ENGINE_START_X + 390} y={EXHAUST_START_Y + 85} textAnchor="middle" className="text-[8px] font-bold" fill="#78350f">CAT</text>
                        </>
                    )}
                </g>

                {/* Section 2 to Muffler */}
                <g
                    onClick={() => onSelectComponent("exhaust")}
                    onMouseEnter={() => setHoveredPart(`Muffler|Type: ${config.exhaust.section3.muffler_type}`)}
                    onMouseLeave={() => setHoveredPart(null)}
                >
                    <path d={`M ${ENGINE_START_X + 250} ${EXHAUST_START_Y + 150} L ${ENGINE_START_X + 250} ${EXHAUST_START_Y + 200}`} stroke="#9f1239" strokeWidth="20" />
                    <rect x={ENGINE_START_X + 100} y={EXHAUST_START_Y + 200} width={300} height={60} rx={5} fill="#881337" />

                    {/* Tailpipes */}
                    <path d={`M ${ENGINE_START_X + 150} ${EXHAUST_START_Y + 260} L ${ENGINE_START_X + 150} ${EXHAUST_START_Y + 280}`} stroke="#cbd5e1" strokeWidth="10" />
                    <path d={`M ${ENGINE_START_X + 180} ${EXHAUST_START_Y + 260} L ${ENGINE_START_X + 180} ${EXHAUST_START_Y + 280}`} stroke="#cbd5e1" strokeWidth="10" />
                    <path d={`M ${ENGINE_START_X + 320} ${EXHAUST_START_Y + 260} L ${ENGINE_START_X + 320} ${EXHAUST_START_Y + 280}`} stroke="#cbd5e1" strokeWidth="10" />
                    <path d={`M ${ENGINE_START_X + 350} ${EXHAUST_START_Y + 260} L ${ENGINE_START_X + 350} ${EXHAUST_START_Y + 280}`} stroke="#cbd5e1" strokeWidth="10" />
                </g>

            </svg>
        </div>
    );
};

export default TopologyView;
