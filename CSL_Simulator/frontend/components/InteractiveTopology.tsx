import React from "react";
import { SimConfig } from "../app/api";

export type SelectionType =
    | { type: "environment" }
    | { type: "intake_duct" }
    | { type: "plenum" }
    | { type: "itb" }
    | { type: "eq_tube" }
    | { type: "runner", index: number }
    | { type: "cylinder", index: number } // Piston/Engine
    | { type: "header", index: number }
    | { type: "collector" }
    | { type: "section1", index: number }
    | { type: "section2" }
    | { type: "muffler" };

interface InteractiveTopologyProps {
    config: SimConfig;
    activeSelection: SelectionType | null;
    onSelect: (selection: SelectionType) => void;
    simulationStatus?: "idle" | "running" | "paused";
}

// Cylinder centre-lines (viewBox 0..380 tall)
const CYL_Y = [50, 100, 150, 200, 250, 300];

const InteractiveTopology: React.FC<InteractiveTopologyProps> = ({ config, activeSelection, onSelect, simulationStatus = "idle" }) => {
    // Check if a specific component is selected
    const isSelected = (matcher: (s: SelectionType) => boolean) => {
        return activeSelection ? matcher(activeSelection) : false;
    };

    // Minimalist Colors (Neutral/Zinc Palette)
    const strokeDefault = "#525252"; // neutral-600
    const strokeSelected = "#d4d4d4"; // neutral-300 (High contrast)
    const fillSelected = "rgba(255, 255, 255, 0.1)";

    const getStroke = (selected: boolean) => selected ? strokeSelected : strokeDefault;
    const getFill = (selected: boolean) => selected ? fillSelected : "transparent";
    const flowAnim = simulationStatus === "running" ? "animate-dash-flow" : "";

    // --- SUB-COMPONENTS ---

    const IntakeSystem = () => (
        <g>
            {/* 1. Intake Duct (Snorkel) */}
            <path
                d="M 44,44 L 50,20 L 80,20 L 86,44 Z"
                fill="none"
                stroke={getStroke(isSelected(s => s.type === "intake_duct"))}
                strokeWidth="2"
                onClick={() => onSelect({ type: "intake_duct" })}
                className="cursor-pointer hover:opacity-80 transition-all"
            />
            <text x="65" y="17" textAnchor="middle" className="text-[10px] fill-neutral-600 font-mono tracking-widest pointer-events-none">DUCT</text>

            {/* 2. Plenum */}
            <rect
                x="38" y="44" width="54" height="272" rx="8"
                fill={getFill(isSelected(s => s.type === "plenum"))}
                stroke={getStroke(isSelected(s => s.type === "plenum"))}
                strokeWidth="2"
                onClick={() => onSelect({ type: "plenum" })}
                className="cursor-pointer hover:opacity-80 transition-all"
            />
            <text x="65" y="346" textAnchor="middle" className="text-[10px] fill-neutral-600 font-mono tracking-widest pointer-events-none">PLENUM</text>

            {/* 3. Runners (x6) */}
            {CYL_Y.map((y, i) => (
                <g key={i}>
                    <line
                        x1="92" y1={y} x2="156" y2={y}
                        stroke={getStroke(isSelected(s => s.type === "runner" && s.index === i))}
                        strokeWidth="9" strokeLinecap="round"
                        onClick={() => onSelect({ type: "runner", index: i })}
                        className="cursor-pointer hover:opacity-80 transition-all"
                    />
                    {simulationStatus === "running" && (
                        <line x1="92" y1={y} x2="156" y2={y} stroke="#737373" strokeWidth="2" strokeDasharray="2,2" className={`pointer-events-none ${flowAnim}`} />
                    )}
                </g>
            ))}
            <text x="112" y="375" textAnchor="middle" className="text-[10px] fill-neutral-600 font-mono tracking-widest pointer-events-none">RUNNER</text>

            {/* 4. Equalization Tube: vertical balance tube crossing all runners (separate node) */}
            <g
                onClick={() => onSelect({ type: "eq_tube" })}
                className="cursor-pointer hover:opacity-80 transition-all"
            >
                <line x1="120" y1="46" x2="120" y2="314" stroke={getStroke(isSelected(s => s.type === "eq_tube"))} strokeWidth="5" strokeLinecap="round" />
                {CYL_Y.map((y, i) => (
                    <circle key={i} cx="120" cy={y} r="3.5" fill={getStroke(isSelected(s => s.type === "eq_tube"))} />
                ))}
            </g>
            <text x="124" y="32" textAnchor="middle" className="text-[9px] fill-neutral-600 font-mono tracking-wide pointer-events-none">EQ TUBE</text>

            {/* 5. ITB butterflies at the runner outlet (separate node) */}
            <g
                onClick={() => onSelect({ type: "itb" })}
                className="cursor-pointer hover:opacity-80 transition-all"
            >
                {CYL_Y.map((y, i) => (
                    <g key={i}>
                        <circle cx="166" cy={y} r="9" fill="#171717" stroke={getStroke(isSelected(s => s.type === "itb"))} strokeWidth="2" />
                        <line x1="159" y1={y} x2="173" y2={y} stroke={getStroke(isSelected(s => s.type === "itb"))} strokeWidth="1.5" />
                    </g>
                ))}
            </g>
            <text x="166" y="346" textAnchor="middle" className="text-[10px] fill-neutral-600 font-mono tracking-widest pointer-events-none">ITB ×6</text>

            {/* Intake ports into head (non-interactive) */}
            {CYL_Y.map((y, i) => (
                <line key={i} x1="175" y1={y} x2="212" y2={y} stroke="#525252" strokeWidth="4" className="pointer-events-none" />
            ))}
        </g>
    );

    const EngineBlock = () => (
        <g>
            <rect x="212" y="30" width="96" height="300" rx="6" fill="#141414" stroke="#333333" strokeWidth="1.5" className="pointer-events-none" />
            {CYL_Y.map((y, i) => {
                const selected = isSelected(s => s.type === "cylinder" && s.index === i);
                return (
                    <g key={i}
                        onClick={() => onSelect({ type: "cylinder", index: i })}
                        className="cursor-pointer hover:opacity-80 transition-all">
                        {/* Cylinder Wall */}
                        <rect x="216" y={y - 21} width="88" height="42" rx="4"
                            fill={selected ? "#2e2e2e" : "#171717"}
                            stroke={getStroke(selected)} strokeWidth="2" />
                        {/* Bore ring */}
                        <circle cx="260" cy={y} r="14" fill="none" stroke={getStroke(selected)} strokeWidth="1.5" />
                        {/* Valves (Intake/Exhaust dots) */}
                        <circle cx="234" cy={y - 8} r="3" fill="#404040" />
                        <circle cx="234" cy={y + 8} r="3" fill="#404040" />
                        <circle cx="286" cy={y - 8} r="3" fill="#404040" />
                        <circle cx="286" cy={y + 8} r="3" fill="#404040" />
                        <text x="260" y={y + 5} textAnchor="middle" fill={getStroke(selected)} className="text-[11px] font-mono pointer-events-none">{i + 1}</text>
                    </g>
                );
            })}
            <text x="260" y="375" textAnchor="middle" className="text-[10px] fill-neutral-600 font-mono tracking-widest pointer-events-none">S54 ENGINE</text>
        </g>
    );

    const ExhaustSystem = () => {
        // Bank Y-centres: cyl 1-3 (top) merge at 105, cyl 4-6 (bottom) merge at 255
        const BANK_Y: [number, number] = [105, 255];
        const collectorX = 388, s1StartX = 406, s1EndX = 486, s2EndX = 596;

        // --- Section 1: dynamic crossover/catalyst geometry (preserves prior
        // config-driven behaviour), re-anchored to the new coordinate system ---
        const s1_1 = config.exhaust.section1_1;
        const s1_2 = config.exhaust.section1_2;

        let safeStartX = s1StartX;
        let safeEndX = s1EndX;
        if (config.exhaust.catalyst.installed) {
            if (config.exhaust.catalyst.location === "header_collector") safeStartX = s1StartX + (s1EndX - s1StartX) * 0.5;
            if (config.exhaust.catalyst.location === "section1_end") safeEndX = s1StartX + (s1EndX - s1StartX) * 0.7;
        }
        const crossXParam = s1StartX + Math.min(1, (s1_1.crossover_offset || 400) / 1000) * (s1EndX - s1StartX);
        const crossX = Math.max(safeStartX + 4, Math.min(safeEndX - 4, crossXParam));
        const midY = (BANK_Y[0] + BANK_Y[1]) / 2;

        const drawS1Path = (bankY: number, conf: { layout: string }) => {
            if (conf.layout !== "X-Pipe") return `M ${s1StartX},${bankY} L ${s1EndX},${bankY}`;
            const cpInX = safeStartX + (crossX - safeStartX) * 0.5;
            const cpOutX = crossX + (safeEndX - crossX) * 0.5;
            return `M ${s1StartX},${bankY} L ${safeStartX},${bankY} C ${cpInX},${bankY} ${cpInX},${midY} ${crossX},${midY} C ${cpOutX},${midY} ${cpOutX},${bankY} ${safeEndX},${bankY} L ${s1EndX},${bankY}`;
        };

        // Catalyst marker position tracks location, same as before (front vs rear)
        const catalystX = config.exhaust.catalyst.location === "section1_end" ? 474 : 434;

        // --- Section 2: dynamic layout + resonator before/after-H, re-anchored ---
        const s2 = config.exhaust.section2;
        const isH = s2.layout === "H-Pipe";
        const isSingle = s2.layout === "Single";
        const res = s2.resonator_fitted;
        const loc = s2.resonator_location || "before_h";
        const s2Scale = (s2EndX - s1EndX) / 100; // rescale legacy 0-100 local units onto the new span
        const bridgeX = s1EndX + ((res && loc === "before_h") ? 75 : 30) * s2Scale;
        const resX = s1EndX + ((isH && res && loc === "after_h") ? 70 : 30) * s2Scale;

        return (
            <g>
                {/* 1. Primaries (x6) merging per bank */}
                {CYL_Y.map((y, i) => {
                    const group = i < 3 ? 0 : 1; // 0=Top(1-3), 1=Bot(4-6)
                    const targetY = BANK_Y[group];
                    const selected = isSelected(s => s.type === "header" && s.index === i);
                    return (
                        <path key={i}
                            d={`M 308,${y} C 348,${y} 364,${targetY} 388,${targetY}`}
                            fill="none" stroke={getStroke(selected)} strokeWidth="4" strokeLinecap="round"
                            onClick={() => onSelect({ type: "header", index: i })}
                            className="cursor-pointer hover:opacity-80 transition-all"
                        />
                    );
                })}

                {/* 2. Collectors (merge cones) */}
                <g onClick={() => onSelect({ type: "collector" })} className="cursor-pointer hover:opacity-80 transition-all">
                    <path d={`M ${collectorX},93 L 406,99 L 406,111 L ${collectorX},117 Z`} fill="#333333" stroke={getStroke(isSelected(s => s.type === "collector"))} strokeWidth="2" />
                    <path d={`M ${collectorX},243 L 406,249 L 406,261 L ${collectorX},267 Z`} fill="#333333" stroke={getStroke(isSelected(s => s.type === "collector"))} strokeWidth="2" />
                </g>
                <text x="397" y="84" textAnchor="middle" className="text-[9px] fill-neutral-500 font-mono tracking-wide pointer-events-none">COL.</text>

                {/* 3. Section 1 + Catalyst (per bank) */}
                <path d={drawS1Path(BANK_Y[0], s1_1)} fill="none" stroke={getStroke(isSelected(s => s.type === "section1" && s.index === 0))} strokeWidth="6" strokeLinecap="round"
                    onClick={(e) => { e.stopPropagation(); onSelect({ type: "section1", index: 0 }); }}
                    className="cursor-pointer hover:opacity-80 transition-all" />
                <path d={drawS1Path(BANK_Y[1], s1_2)} fill="none" stroke={getStroke(isSelected(s => s.type === "section1" && s.index === 1))} strokeWidth="6" strokeLinecap="round"
                    onClick={(e) => { e.stopPropagation(); onSelect({ type: "section1", index: 1 }); }}
                    className="cursor-pointer hover:opacity-80 transition-all" />
                {config.exhaust.catalyst.installed && (
                    <>
                        <rect x={catalystX} y={BANK_Y[0] - 7} width="24" height="14" rx="2" fill="#d97706" opacity="0.85" className="pointer-events-none" />
                        <rect x={catalystX} y={BANK_Y[1] - 7} width="24" height="14" rx="2" fill="#d97706" opacity="0.85" className="pointer-events-none" />
                    </>
                )}
                <text x="446" y="346" textAnchor="middle" className="text-[10px] fill-neutral-600 font-mono tracking-widest pointer-events-none">SEC 1 · CAT</text>

                {/* 4. Section 2: layout-reactive (Independent / H-Pipe / Single) + resonators */}
                <g onClick={() => onSelect({ type: "section2" })} className="cursor-pointer hover:opacity-80 transition-all">
                    {isSingle ? (
                        <>
                            <path d={`M ${s1EndX},${BANK_Y[0]} L 556,180 L ${s2EndX},180`} fill="none" stroke={getStroke(isSelected(s => s.type === "section2"))} strokeWidth="6" strokeLinecap="round" />
                            <path d={`M ${s1EndX},${BANK_Y[1]} L 556,180`} fill="none" stroke={getStroke(isSelected(s => s.type === "section2"))} strokeWidth="6" strokeLinecap="round" />
                            {res && <rect x="510" y="172" width="40" height="16" rx="2" fill="#262626" />}
                        </>
                    ) : (
                        <>
                            <line x1={s1EndX} y1={BANK_Y[0]} x2={s2EndX} y2={BANK_Y[0]} stroke={getStroke(isSelected(s => s.type === "section2"))} strokeWidth="6" strokeLinecap="round" />
                            <line x1={s1EndX} y1={BANK_Y[1]} x2={s2EndX} y2={BANK_Y[1]} stroke={getStroke(isSelected(s => s.type === "section2"))} strokeWidth="6" strokeLinecap="round" />
                            {isH && <line x1={bridgeX} y1={BANK_Y[0]} x2={bridgeX} y2={BANK_Y[1]} stroke="#525252" strokeWidth="4" />}
                            {res && (
                                <>
                                    <rect x={resX - 15} y={BANK_Y[0] - 8} width="30" height="16" rx="2" fill="#262626" stroke={getStroke(isSelected(s => s.type === "section2"))} strokeWidth="1" />
                                    <rect x={resX - 15} y={BANK_Y[1] - 8} width="30" height="16" rx="2" fill="#262626" stroke={getStroke(isSelected(s => s.type === "section2"))} strokeWidth="1" />
                                </>
                            )}
                        </>
                    )}
                </g>
                <text x="541" y="375" textAnchor="middle" className="text-[9px] fill-neutral-600 font-mono tracking-wide pointer-events-none">
                    SEC 2 · {s2.layout.toUpperCase()}
                </text>

                {/* 5. Muffler & Tails */}
                <g onClick={() => onSelect({ type: "muffler" })} className="cursor-pointer hover:opacity-80 transition-all">
                    <rect x={s2EndX} y="90" width="80" height="180" rx="8"
                        fill={getFill(isSelected(s => s.type === "muffler"))}
                        stroke={getStroke(isSelected(s => s.type === "muffler"))} strokeWidth="2" />
                    {/* Tips (Quad) */}
                    <line x1="676" y1="99" x2="698" y2="99" stroke="#737373" strokeWidth="5" strokeLinecap="round" />
                    <line x1="676" y1="111" x2="698" y2="111" stroke="#737373" strokeWidth="5" strokeLinecap="round" />
                    <line x1="676" y1="249" x2="698" y2="249" stroke="#737373" strokeWidth="5" strokeLinecap="round" />
                    <line x1="676" y1="261" x2="698" y2="261" stroke="#737373" strokeWidth="5" strokeLinecap="round" />

                    {/* Exhaust Smoke Animation */}
                    {simulationStatus === "running" && (
                        <g transform="translate(700, 180)">
                            <circle r="3" fill="#d4d4d4" className="animate-ping" opacity="0.5" />
                        </g>
                    )}
                </g>
                <text x="636" y="350" textAnchor="middle" className="text-[10px] fill-neutral-600 font-mono tracking-widest pointer-events-none">MUFFLER</text>
            </g>
        );
    };

    return (
        <div className="w-full h-full flex items-center justify-center p-12 bg-neutral-950/60 rounded-lg border border-neutral-800 overflow-hidden relative group">

            <svg
                viewBox="0 0 760 380"
                preserveAspectRatio="xMidYMid meet"
                className="w-full h-full max-w-full max-h-full drop-shadow-2xl"
            >
                <IntakeSystem />
                <EngineBlock />
                <ExhaustSystem />
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
