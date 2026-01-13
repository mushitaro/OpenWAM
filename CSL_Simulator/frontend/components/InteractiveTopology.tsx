import React from "react";
import { SimConfig } from "../app/api";

export type SelectionType =
    | { type: "environment" }
    | { type: "intake_duct" }
    | { type: "plenum" }
    | { type: "runner", index: number }
    | { type: "cylinder", index: number } // Piston/Engine
    | { type: "header", index: number }
    | { type: "collector" }
    | { type: "section1" }
    | { type: "section2" }
    | { type: "muffler" };

interface InteractiveTopologyProps {
    config: SimConfig;
    activeSelection: SelectionType | null;
    onSelect: (selection: SelectionType) => void;
    simulationStatus?: "idle" | "running" | "paused";
}

const InteractiveTopology: React.FC<InteractiveTopologyProps> = ({ config, activeSelection, onSelect, simulationStatus = "idle" }) => {
    // Check if a specific component is selected
    const isSelected = (matcher: (s: SelectionType) => boolean) => {
        return activeSelection ? matcher(activeSelection) : false;
    };

    // Minimalist Colors (Neutral/Zinc Palette)
    const strokeDefault = "#525252"; // neutral-600
    const strokeSelected = "#d4d4d4"; // neutral-300 (High contrast)
    const fillSelected = "rgba(255, 255, 255, 0.1)";
    const fillHover = "rgba(255, 255, 255, 0.05)";

    const getStroke = (selected: boolean) => selected ? strokeSelected : strokeDefault;
    const getFill = (selected: boolean) => selected ? fillSelected : "transparent";
    const flowAnim = simulationStatus === "running" ? "animate-dash-flow" : "";

    // --- SUB-COMPONENTS ---

    const IntakeSystem = () => {
        const ductLen = 50;
        const plenumW = 100;
        const plenumH = 180;

        return (
            <g transform="translate(20, 50)">
                {/* 1. Intake Duct (Snorkel) */}
                <path
                    d={`M 0,20 L ${ductLen},20`}
                    stroke={getStroke(isSelected(s => s.type === "intake_duct"))}
                    strokeWidth="12"
                    fill="none"
                    onClick={() => onSelect({ type: "intake_duct" })}
                    className="cursor-pointer hover:opacity-80 transition-all"
                />
                <text x="0" y="5" className="text-[8px] fill-neutral-600 font-mono tracking-widest">DUCT</text>

                {/* 2. Plenum */}
                <g transform={`translate(${ductLen}, 0)`} onClick={() => onSelect({ type: "plenum" })} className="cursor-pointer hover:opacity-80 transition-all">
                    <rect x="0" y="0" width={plenumW} height={plenumH} rx="4"
                        fill={getFill(isSelected(s => s.type === "plenum"))}
                        stroke={getStroke(isSelected(s => s.type === "plenum"))} strokeWidth="2" />
                    <text x="50" y="195" textAnchor="middle" className="text-[10px] fill-neutral-600 pointer-events-none font-mono tracking-widest">PLENUM</text>
                </g>

                {/* 3. Runners (x6) */}
                {[0, 1, 2, 3, 4, 5].map(i => (
                    <g key={i} transform={`translate(${ductLen + plenumW}, ${20 + i * 28})`}
                        onClick={() => onSelect({ type: "runner", index: i })}
                        className="cursor-pointer hover:opacity-80 transition-all">
                        {/* Runner Pipe */}
                        <path d={`M 0,0 L 40,0`} stroke={getStroke(isSelected(s => s.type === "runner" && s.index === i))} strokeWidth="6" />

                        {/* Funnel / Bellmouth Visual */}
                        <path d="M 0,-4 Q 5,-4 5,0 Q 5,4 0,4" fill="none" stroke="#525252" strokeWidth="1" />

                        {/* Flow Animation */}
                        {simulationStatus === "running" && (
                            <path d="M 0,0 L 40,0" stroke="#737373" strokeWidth="2" strokeDasharray="2,2" className={flowAnim} />
                        )}
                    </g>
                ))}
            </g>
        );
    };

    const EngineBlock = () => {
        const startX = 20 + 50 + 100 + 40; // Duct + Plenum + Runners
        const startY = 50;

        return (
            <g transform={`translate(${startX}, ${startY})`}>
                <text x="5" y="-15" className="text-[10px] fill-neutral-600 font-mono tracking-widest">S54 ENGINE</text>
                {/* Cylinders (x6) */}
                {[0, 1, 2, 3, 4, 5].map(i => {
                    const selected = isSelected(s => s.type === "cylinder" && s.index === i);
                    return (
                        <g key={i} transform={`translate(0, ${20 + i * 28})`}
                            onClick={() => onSelect({ type: "cylinder", index: i })}
                            className="cursor-pointer hover:opacity-80 transition-all">

                            {/* Cylinder Wall */}
                            <rect x="0" y="-12" width="60" height="24" rx="2"
                                fill={selected ? fillSelected : "#171717"} // neutral-900
                                stroke={getStroke(selected)} strokeWidth="2" />

                            {/* Piston Head */}
                            <rect x="20" y="-10" width="10" height="20" fill="#404040" />

                            {/* Connecting Rod Line */}
                            <line x1="30" y1="0" x2="60" y2="0" stroke="#404040" strokeWidth="1" />

                            {/* Valves (Intake/Exhaust Tiny Lines on Left/Right) */}
                            <line x1="2" y1="-8" x2="2" y2="8" stroke={selected ? "#d4d4d4" : "#525252"} strokeWidth="2" />
                            <text x="45" y="4" className="text-[8px] fill-neutral-700 select-none font-mono">{i + 1}</text>
                        </g>
                    );
                })}
            </g>
        );
    };

    const ExhaustSystem = () => {
        const startX = 20 + 50 + 100 + 40 + 60; // Previous + Engine Width
        const startY = 50;

        return (
            <g transform={`translate(${startX}, ${startY})`}>
                <text x="10" y="-15" className="text-[10px] fill-neutral-600 font-mono tracking-widest">HEADERS / EXHAUST</text>

                {/* 1. Primaries (x6) */}
                {[0, 1, 2, 3, 4, 5].map(i => {
                    const group = i < 3 ? 0 : 1; // 0=Top(1-3), 1=Bot(4-6)
                    const targetY = group === 0 ? 50 : 130;
                    const sourceY = 20 + i * 28;
                    const selected = isSelected(s => s.type === "header" && s.index === i);

                    return (
                        <path key={i}
                            d={`M 0,${sourceY} C 30,${sourceY} 30,${targetY} 60,${targetY}`}
                            fill="none"
                            stroke={getStroke(selected)}
                            strokeWidth="4"
                            onClick={() => onSelect({ type: "header", index: i })}
                            className="cursor-pointer hover:stroke-neutral-400 transition-colors"
                        />
                    );
                })}

                {/* 2. Section 1 (Front Pipe + Cats) */}
                <g transform="translate(60, 50)">
                    {/* Collectors */}
                    <circle cx="0" cy="0" r="8" fill="#333" stroke={getStroke(isSelected(s => s.type === "collector"))} strokeWidth="2" className="cursor-pointer hover:fill-neutral-600" onClick={(e) => { e.stopPropagation(); onSelect({ type: "collector" }); }} />
                    <circle cx="0" cy="80" r="8" fill="#333" stroke={getStroke(isSelected(s => s.type === "collector"))} strokeWidth="2" className="cursor-pointer hover:fill-neutral-600" onClick={(e) => { e.stopPropagation(); onSelect({ type: "collector" }); }} />

                    {/* Label */}
                    <text x="-10" y="-15" className="text-[8px] fill-neutral-500 font-mono tracking-widest pointer-events-none">COL.</text>

                    {/* Dynamic Pipes with Crossing Logic */}
                    {(() => {
                        const s1 = config.exhaust.section1_1;
                        const s2 = config.exhaust.section1_2;

                        // Calculate Safe Zones for Straightness (Catalyst Protection)
                        // Visual X coordinates: 0 to 100
                        // Front Cat: 25-45 (center 35, width 20). Safe until 50.
                        // Rear Cat: 75-95 (center 85, width 20). Safe from 70.
                        let safe_start_x = 0;
                        let safe_end_x = 100;

                        if (config.exhaust.catalyst.installed) {
                            if (config.exhaust.catalyst.location === "header_collector") safe_start_x = 50;
                            if (config.exhaust.catalyst.location === "section1_end") safe_end_x = 70;
                        }

                        // Determine Crossover Point
                        // Clamp visual crossover to be loosely within safe zones (with 5px buffer for curve)
                        let x_cross_param = (s1.crossover_offset || 400) / 10;
                        let x_cross = Math.max(safe_start_x + 5, Math.min(safe_end_x - 5, x_cross_param));

                        // Path Logic
                        const drawPath = (bank: 1 | 2, conf: any) => {
                            const yStart = bank === 1 ? 0 : 80;
                            if (conf.layout !== "X-Pipe") return `M 0,${yStart} L 100,${yStart}`;

                            // Bezier Curve Logic for >< shape
                            const cp_in_x = safe_start_x + (x_cross - safe_start_x) * 0.5;
                            const cp_out_x = x_cross + (safe_end_x - x_cross) * 0.5;

                            return `
                               M 0,${yStart}
                               L ${safe_start_x},${yStart}
                               C ${cp_in_x},${yStart} ${cp_in_x},40 ${x_cross},40
                               C ${cp_out_x},40 ${cp_out_x},${yStart} ${safe_end_x},${yStart}
                               L 100,${yStart}
                           `;
                        };

                        return (
                            <>
                                {/* Pipes */}
                                <path d={drawPath(1, s1)} stroke={getStroke(isSelected(s => s.type === "section1" && s.index === 0))} strokeWidth="6" fill="none" className="cursor-pointer hover:stroke-neutral-400 transition-all duration-300" onClick={(e) => { e.stopPropagation(); onSelect({ type: "section1", index: 0 }); }} />
                                <path d={drawPath(2, s2)} stroke={getStroke(isSelected(s => s.type === "section1" && s.index === 1))} strokeWidth="6" fill="none" className="cursor-pointer hover:stroke-neutral-400 transition-all duration-300" onClick={(e) => { e.stopPropagation(); onSelect({ type: "section1", index: 1 }); }} />

                                {/* Catalysts positioned on paths - Fixed Locations */}
                                {config.exhaust.catalyst.installed && (
                                    <>
                                        {config.exhaust.catalyst.location === "header_collector" && (
                                            <>
                                                <rect x="25" y="-5" width="20" height="10" rx="2" fill="#d97706" opacity="0.8" className="pointer-events-none" />
                                                <rect x="25" y="75" width="20" height="10" rx="2" fill="#d97706" opacity="0.8" className="pointer-events-none" />
                                            </>
                                        )}
                                        {config.exhaust.catalyst.location === "section1_end" && (
                                            <>
                                                <rect x="75" y="-5" width="20" height="10" rx="2" fill="#d97706" opacity="0.8" className="pointer-events-none" />
                                                <rect x="75" y="75" width="20" height="10" rx="2" fill="#d97706" opacity="0.8" className="pointer-events-none" />
                                            </>
                                        )}
                                    </>
                                )}


                            </>
                        );
                    })()}

                    <text x="50" y="-20" className="text-[8px] fill-neutral-600 font-mono tracking-widest">
                        SEC 1 {config.exhaust.catalyst.installed ? "+ CAT" : ""}
                    </text>
                </g>

                {/* 3. Section 2 (Mid Pipe) */}
                <g transform="translate(160, 50)" onClick={() => onSelect({ type: "section2" })} className="cursor-pointer hover:opacity-80 transition-all">

                    {/* Visual Logic based on Layout */}
                    {/* Visual Logic based on Layout */}
                    {(() => {
                        const s2 = config.exhaust.section2;
                        const isH = s2.layout === "H-Pipe";
                        const res = s2.resonator_fitted;
                        const loc = s2.resonator_location || "before_h";

                        // Dynamic Positions
                        // If Resonator is "Before H", Bridge moves to Rear (75), Resonator at Front (30)
                        // If Resonator is "After H", Bridge stays Front (30), Resonator at Rear (70)
                        // If No Resonator, Bridge at Front (30)

                        const bridgeX = (res && loc === "before_h") ? 75 : 30;
                        const resX = (isH && res && loc === "after_h") ? 70 : 30;

                        return (
                            <>
                                {s2.layout === "Single" ? (
                                    /* Single Pipe Merge */
                                    <>
                                        <path d="M 0,0 L 20,40 L 100,40 M 0,80 L 20,40" stroke={getStroke(isSelected(s => s.type === "section2"))} strokeWidth="8" fill="none" />
                                        {res && <rect x="40" y="32" width="40" height="20" fill="#262626" rx="2" />}
                                    </>
                                ) : (
                                    /* Dual Pipe (Independent or H-Pipe) */
                                    <>
                                        <path d="M 0,0 L 100,0" stroke={getStroke(isSelected(s => s.type === "section2"))} strokeWidth="6" />
                                        <path d="M 0,80 L 100,80" stroke={getStroke(isSelected(s => s.type === "section2"))} strokeWidth="6" />

                                        {isH && (
                                            <path d={`M ${bridgeX},0 L ${bridgeX},80`} stroke="#525252" strokeWidth="4" />
                                        )}

                                        {res && (
                                            <>
                                                <rect x={resX} y="-8" width="30" height="16" fill="#262626" rx="2" />
                                                <rect x={resX} y="72" width="30" height="16" fill="#262626" rx="2" />
                                            </>
                                        )}
                                    </>
                                )}
                            </>
                        );
                    })()}

                    <text x="50" y="-15" className="text-[8px] fill-neutral-600 font-mono tracking-widest">SEC 2</text>
                </g>

                {/* 4. Muffler & Tails */}
                <g transform="translate(260, 50)" onClick={() => onSelect({ type: "muffler" })} className="cursor-pointer hover:opacity-80 transition-all">
                    {/* Main Silencer Can */}
                    <rect x="0" y="-20" width="60" height="120" rx="4"
                        fill={getFill(isSelected(s => s.type === "muffler"))}
                        stroke={getStroke(isSelected(s => s.type === "muffler"))} strokeWidth="2" />

                    {/* Tips (Quad) */}
                    <path d="M 60,0 L 80,0" stroke="#737373" strokeWidth="4" />
                    <path d="M 60,10 L 80,10" stroke="#737373" strokeWidth="4" />
                    <path d="M 60,70 L 80,70" stroke="#737373" strokeWidth="4" />
                    <path d="M 60,80 L 80,80" stroke="#737373" strokeWidth="4" />

                    <text x="30" y="45" textAnchor="middle" className="text-[8px] fill-neutral-600 font-mono rotate-90 tracking-widest">MUFFLER</text>

                    {/* Exhaust Smoke Animation */}
                    {simulationStatus === "running" && (
                        <g transform="translate(85, 40)">
                            <circle r="3" fill="#d4d4d4" className="animate-ping" opacity="0.5" />
                        </g>
                    )}
                </g>
            </g>
        );
    };

    return (
        <div className="w-full h-full flex items-center justify-center p-8 bg-neutral-950/50 rounded-lg border border-neutral-900 overflow-hidden relative group">

            <svg
                viewBox="-20 -20 700 300"
                preserveAspectRatio="xMidYMid meet"
                className="w-full h-full max-w-full max-h-full drop-shadow-2xl"
            >
                {/* Subtle Grid Background */}
                <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#262626" strokeWidth="0.5" />
                    </pattern>
                </defs>
                {/* <rect x="-20" y="-20" width="100%" height="100%" fill="url(#grid)" opacity="0.5" /> */}

                <IntakeSystem />
                <EngineBlock />
                <ExhaustSystem />

                {/* Connection Lines between systems - Minimal style */}
                <path d="M 170,100 L 210,100" stroke="#404040" strokeWidth="1" strokeDasharray="2,2" />
            </svg>

            <style>{`
                @keyframes dash-flow {
                    from { stroke-dashoffset: 20; }
                    to { stroke-dashoffset: 0; }
                }
                .animate-dash-flow {
                    animation: dash-flow 0.5s linear infinite;
                }
            `}</style>
        </div>
    );
};

export default InteractiveTopology;
