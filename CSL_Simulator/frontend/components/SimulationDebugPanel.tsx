"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Terminal, Network, Play, RefreshCw, XCircle } from "lucide-react";
import { SimConfig, getTopology, WS_BASE_URL } from "../app/api";

const LOG_WINDOW_SIZE = 1000; // Keep last 1000 lines for performance

const SimulationDebugPanel = ({ config }: { config: SimConfig }) => {
    const [topology, setTopology] = useState<any>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [status, setStatus] = useState<"idle" | "running" | "error" | "complete">("idle");
    const [tab, setTab] = useState<"topology" | "console">("console");
    const wsRef = useRef<WebSocket | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);

    // Windowed Logs for Performance (useMemo as requested)
    const windowedLogs = useMemo(() => {
        if (logs.length <= LOG_WINDOW_SIZE) return logs;
        return logs.slice(-LOG_WINDOW_SIZE);
    }, [logs]);

    // Auto-scroll logs
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [windowedLogs]);

    // Connect to System Logs (Global)
    useEffect(() => {
        const ws = new WebSocket(`${WS_BASE_URL}/ws/logs`);
        ws.onopen = () => {
            console.log("Connected to System Logs");
            // Optional: setSystemLogs(prev => [...prev, "INFO: Connected to System Log Stream"]);
        };
        ws.onmessage = (event) => {
            const msg = event.data;
            if (msg === "pong") return;
            // setSystemLogs(prev => [...prev, `[SYS] ${msg}`]);
            setLogs(prev => [...prev, msg]); // Merge into main logs
        };
        ws.onerror = (e) => console.error("System Log WS Error", e);

        // Keep alive
        const pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 30000);

        return () => {
            clearInterval(pingInterval);
            ws.close();
        };
    }, []);

    const fetchTopology = async () => {
        try {
            const data = await getTopology(config);
            setTopology(data);
        } catch (e: any) {
            console.error(e);
            setLogs(prev => [...prev, `ERROR fetching topology: ${e.message}`]);
        }
    };

    const runSimulation = () => {
        if (wsRef.current) {
            wsRef.current.close();
        }

        setStatus("running");
        setLogs(prev => [...prev, "--- Starting Live Simulation ---"]); // Don't clear previous logs? Or clear?
        // Let's clear for a clean run, but maybe we lose System logs?
        // Better NOT to clear if we want unified history.
        // setLogs([]); 
        setTab("console");

        const ws = new WebSocket(`${WS_BASE_URL}/ws/debug/run`);
        wsRef.current = ws;

        ws.onopen = () => {
            setLogs(prev => [...prev, "INFO: Live Sim WebSocket Connected"]);
            // Send config
            ws.send(JSON.stringify(config));
        };

        ws.onmessage = (event) => {
            const msg = event.data;
            if (msg === "END_OF_STREAM") {
                setStatus("complete");
                ws.close();
            } else {
                // Split lines just in case
                const lines = msg.split('\n').filter((l: string) => l);
                setLogs(prev => [...prev, ...lines]);
            }
        };

        ws.onerror = (e) => {
            console.error(e);
            setLogs(prev => [...prev, "ERROR: Live Sim WebSocket Failed"]);
            setStatus("error");
        };

        ws.onclose = () => {
            if (status === "running") { // Unexpected close
                // setLogs(prev => [...prev, "INFO: WebSocket Closed"]);
            }
        };
    };

    const stopSimulation = () => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
            setStatus("idle");
            setLogs(prev => [...prev, "INFO: Simulation Aborted by User"]);
        }
    };

    return (
        <div className="bg-slate-900 rounded-xl border border-slate-700 flex flex-col h-[600px] overflow-hidden">
            {/* Header / Toolbar */}
            <div className="bg-slate-800 p-3 flex items-center justify-between border-b border-slate-700">
                <div className="flex gap-2">
                    <button
                        onClick={() => setTab("console")}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-bold ${tab === "console" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
                    >
                        <Terminal size={16} /> Console
                    </button>
                    <button
                        onClick={() => { setTab("topology"); fetchTopology(); }}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-bold ${tab === "topology" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
                    >
                        <Network size={16} /> Topology
                    </button>
                    <button
                        onClick={() => setLogs([])}
                        className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-bold text-slate-400 hover:text-red-400 ml-2"
                        title="Clear Logs"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                    </button>
                </div>

                <div className="flex gap-2">
                    {status === "running" ? (
                        <button onClick={stopSimulation} className="flex items-center gap-2 px-4 py-1.5 bg-red-900/50 text-red-200 border border-red-700 rounded text-xs font-bold hover:bg-red-900">
                            <XCircle size={14} /> Stop
                        </button>
                    ) : (
                        <button onClick={runSimulation} className="flex items-center gap-2 px-4 py-1.5 bg-green-700 text-white rounded text-xs font-bold hover:bg-green-600 shadow-lg shadow-green-900/20">
                            <Play size={14} /> Run Live Sim
                        </button>
                    )}
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto bg-black p-4 font-mono text-xs">
                {tab === "console" && (
                    <div className="space-y-1">
                        {windowedLogs.length === 0 && <span className="text-slate-600">Ready to simulate... (System Logs Active)</span>}
                        {windowedLogs.map((log, i) => (
                            <div key={i} className={`whitespace-pre-wrap break-all ${log.includes("ERROR") || log.includes("EXCEPTION") ? "text-red-400" :
                                log.includes("INFO") ? "text-blue-400" :
                                    log.includes("WARNING") ? "text-yellow-400" :
                                        "text-slate-300"
                                }`}>
                                {log}
                            </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>
                )}

                {tab === "topology" && (
                    <div className="text-emerald-400">
                        {topology ? (
                            <pre>{JSON.stringify(topology, null, 2)}</pre>
                        ) : (
                            <div className="flex items-center gap-2 text-slate-500">
                                <RefreshCw className="animate-spin" size={16} /> Loading Topology...
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SimulationDebugPanel;
