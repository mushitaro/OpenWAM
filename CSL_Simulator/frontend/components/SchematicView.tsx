"use client";

import React from "react";
import { Wind, Settings2, Fan, ArrowRight, Activity, Gauge } from "lucide-react";

interface SchematicViewProps {
    activeSection: "intake" | "engine" | "exhaust" | "patch";
    onSectionSelect: (section: "intake" | "engine" | "exhaust" | "patch") => void;
}

const SchematicView: React.FC<SchematicViewProps> = ({ activeSection, onSectionSelect }) => {

    // Enhanced Node with Sub-label support
    const Node = ({ id, label, subLabel, icon: Icon, color, mappedSection }: {
        id: string,
        label: string,
        subLabel?: string,
        icon: any,
        color: string,
        mappedSection: "intake" | "engine" | "exhaust"
    }) => (
        <button
            onClick={() => onSectionSelect(mappedSection)}
            className={`
                group relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all duration-300 min-w-[100px]
                ${activeSection === mappedSection
                    ? `bg-slate-800 border-${color}-500 shadow-[0_0_15px_rgba(var(--${color}-rgb),0.2)] scale-105`
                    : "bg-slate-900 border-slate-700 hover:border-slate-500 hover:bg-slate-800"}
            `}
        >
            <div className={`
                p-2 rounded-full bg-slate-800 border border-slate-700 
                ${activeSection === mappedSection ? `text-${color}-400` : "text-slate-400 group-hover:text-slate-200"}
            `}>
                <Icon size={20} />
            </div>
            <div className="flex flex-col items-center">
                <span className={`font-bold text-xs ${activeSection === mappedSection ? "text-white" : "text-slate-400"}`}>
                    {label}
                </span>
                {subLabel && (
                    <span className="text-[10px] text-slate-500 font-mono tracking-tighter">
                        {subLabel}
                    </span>
                )}
            </div>
        </button>
    );

    const Arrow = () => (
        <div className="text-slate-700">
            <ArrowRight size={16} />
        </div>
    );

    return (
        <div className="w-full bg-slate-950 rounded-xl p-4 border border-slate-800 shadow-inner overflow-x-auto">
            <div className="flex items-center justify-between min-w-[800px] gap-2">

                {/* 1. Intake */}
                <Node id="intake" label="Intake" subLabel="Box/ITB" icon={Wind} color="sky" mappedSection="intake" />
                <Arrow />

                {/* 2. Engine */}
                <Node id="engine" label="Engine" subLabel="S54 Block" icon={Settings2} color="emerald" mappedSection="engine" />
                <Arrow />

                {/* 3. Headers */}
                <Node id="headers" label="Headers" subLabel="3-into-1" icon={Fan} color="rose" mappedSection="exhaust" />
                <Arrow />

                {/* 4. Section 1 */}
                <Node id="sec1" label="Section 1" subLabel="Cats/X-Pipe" icon={Activity} color="rose" mappedSection="exhaust" />
                <Arrow />

                {/* 5. Section 2 */}
                <Node id="sec2" label="Section 2" subLabel="Resonator" icon={Activity} color="rose" mappedSection="exhaust" />
                <Arrow />

                {/* 6. Muffler */}
                <Node id="muffler" label="Muffler" subLabel="Chamber" icon={Gauge} color="rose" mappedSection="exhaust" />
                <Arrow />

                {/* 7. Tail */}
                <div className="flex flex-col items-center opacity-50">
                    <span className="text-xs text-slate-600 font-mono">TAIL</span>
                    <Wind size={16} className="text-slate-600" />
                </div>

            </div>

            <div className="mt-2 text-center text-[10px] text-slate-600 font-mono">
                7-STAGE GAS DYNAMICS PIPELINE
            </div>
        </div>
    );
};

export default SchematicView;
