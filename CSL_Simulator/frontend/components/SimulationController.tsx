import React from "react";
import { Play, Zap, Settings, Upload, Download, Pause, Square } from "lucide-react";

interface SimulationControllerProps {
    status: "idle" | "running" | "paused";
    progress: number;
    onRunFlow: () => void;
    onRunHardwareOpt: () => void;
    onRunVanosOpt: () => void;
    onStop: () => void;
    onPause: () => void;
    onUploadBin: () => void;
    onDownloadBin: () => void;
    onUploadConfig: () => void;
    onDownloadConfig: () => void;
}

const SimulationController: React.FC<SimulationControllerProps> = ({
    status, progress,
    onRunFlow, onRunHardwareOpt, onRunVanosOpt,
    onStop, onPause,
    onUploadBin, onDownloadBin,
    onUploadConfig, onDownloadConfig
}) => {
    const isRunning = status === "running";

    return (
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex flex-col gap-4">
            <h3 className="text-sm font-bold text-slate-400 uppercase">Simulation Control</h3>

            {/* Main Actions Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {/* 1. Flow Calibration */}
                <button onClick={onRunFlow} disabled={isRunning} className="flex flex-col items-center justify-center p-3 bg-emerald-900/30 border border-emerald-700 hover:bg-emerald-800/50 rounded-lg transition-all disabled:opacity-50">
                    <Play size={20} className="text-emerald-400 mb-1" />
                    <span className="text-xs font-bold text-emerald-100">Run Flow Sim</span>
                    <span className="text-[10px] text-emerald-400/70">Single Point / Verify</span>
                </button>

                {/* 2. Hardware Opt */}
                <button onClick={onRunHardwareOpt} disabled={isRunning} className="flex flex-col items-center justify-center p-3 bg-blue-900/30 border border-blue-700 hover:bg-blue-800/50 rounded-lg transition-all disabled:opacity-50">
                    <Settings size={20} className="text-blue-400 mb-1" />
                    <span className="text-xs font-bold text-blue-100">Auto-Opt Hardware</span>
                    <span className="text-[10px] text-blue-400/70">Find Best Geometry</span>
                </button>

                {/* 3. VANOS Opt */}
                <button onClick={onRunVanosOpt} disabled={isRunning} className="flex flex-col items-center justify-center p-3 bg-purple-900/30 border border-purple-700 hover:bg-purple-800/50 rounded-lg transition-all disabled:opacity-50">
                    <Zap size={20} className="text-purple-400 mb-1" />
                    <span className="text-xs font-bold text-purple-100">Auto-Opt VANOS</span>
                    <span className="text-[10px] text-purple-400/70">Sweep Cam Timing</span>
                </button>
            </div>

            {/* Run Controls (Visible when active) */}
            {status !== "idle" && (
                <div className="bg-slate-900/50 p-2 rounded flex items-center gap-3 border border-slate-700 animate-in fade-in slide-in-from-top-2">
                    <div className="flex gap-1">
                        <button onClick={onPause} className="p-2 bg-yellow-600 hover:bg-yellow-500 rounded text-white"><Pause size={16} /></button>
                        <button onClick={onStop} className="p-2 bg-red-600 hover:bg-red-500 rounded text-white"><Square size={16} /></button>
                    </div>
                    <div className="flex-1">
                        <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                            <span>Processing...</span>
                            <span>{progress.toFixed(0)}%</span>
                        </div>
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }}></div>
                        </div>
                    </div>
                </div>
            )}

            {/* File I/O Bar */}
            <div className="grid grid-cols-4 gap-2 border-t border-slate-700 pt-3">
                <button onClick={onUploadConfig} className="flex items-center justify-center gap-1 p-2 bg-slate-700 hover:bg-slate-600 rounded text-[10px] text-slate-300">
                    <Upload size={12} /> Load Config
                </button>
                <button onClick={onDownloadConfig} className="flex items-center justify-center gap-1 p-2 bg-slate-700 hover:bg-slate-600 rounded text-[10px] text-slate-300">
                    <Download size={12} /> Save Config
                </button>
                <button onClick={onUploadBin} className="flex items-center justify-center gap-1 p-2 bg-amber-900/40 border border-amber-900/50 hover:bg-amber-800/40 rounded text-[10px] text-amber-200">
                    <Upload size={12} /> Upload BIN
                </button>
                <button onClick={onDownloadBin} className="flex items-center justify-center gap-1 p-2 bg-emerald-900/40 border border-emerald-900/50 hover:bg-emerald-800/40 rounded text-[10px] text-emerald-200">
                    <Download size={12} /> Patch BIN
                </button>
            </div>

        </div>
    );
};

export default SimulationController;
