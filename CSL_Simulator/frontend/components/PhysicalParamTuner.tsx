"use client";

import React, { useState } from "react";
import { SimConfig } from "../app/api";

interface PhysicalParamTunerProps {
    config: SimConfig;
    onConfigChange: (newConfig: SimConfig) => void;
}

// Collapsible Section Component
const Accordion: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean; colorClass?: string }> = ({
    title, children, defaultOpen = false, colorClass = "text-slate-200"
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className="border border-slate-700 rounded overflow-hidden">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full bg-slate-800 p-3 text-left text-sm font-semibold flex justify-between items-center hover:bg-slate-700 transition"
            >
                <span className={colorClass}>{title}</span>
                <span className="text-slate-500 text-xs">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
                <div className="p-4 bg-slate-900 border-t border-slate-700 space-y-4">
                    {children}
                </div>
            )}
        </div>
    );
};

const PhysicalParamTuner: React.FC<PhysicalParamTunerProps> = ({ config, onConfigChange }) => {

    const updateValue = (path: string[], value: any) => {
        const newConfig = JSON.parse(JSON.stringify(config));
        let current = newConfig;
        for (let i = 0; i < path.length - 1; i++) {
            current = current[path[i]];
        }
        current[path[path.length - 1]] = value;
        onConfigChange(newConfig);
    };

    const updateNumber = (path: string[], value: string) => {
        const numVal = parseFloat(value);
        if (!isNaN(numVal)) updateValue(path, numVal);
    };

    const updateBool = (path: string[], value: boolean) => {
        updateValue(path, value);
    };

    // Helper for Text Input Fields
    const Field = ({ label, value, path, type = "number", unit = "" }: { label: string, value: any, path: string[], type?: string, unit?: string }) => (
        <div>
            <label className="block text-xs text-slate-400 mb-1">{label} {unit && `(${unit})`}</label>
            <input
                type={type}
                value={value}
                onChange={(e) => type === "number" ? updateNumber(path, e.target.value) : updateValue(path, e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded p-1.5 text-slate-200 text-xs focus:border-emerald-500 outline-none"
            />
        </div>
    );

    // Helper for Checkbox
    const Checkbox = ({ label, value, path }: { label: string, value: boolean, path: string[] }) => (
        <div className="flex items-center gap-2">
            <input
                type="checkbox"
                checked={value}
                onChange={(e) => updateBool(path, e.target.checked)}
                className="rounded bg-slate-800 border-slate-600 text-emerald-500 focus:ring-0"
            />
            <label className="text-xs text-slate-400">{label}</label>
        </div>
    );

    return (
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 shadow-lg h-full overflow-y-auto flex flex-col gap-4">
            <h2 className="text-lg font-bold text-slate-200 border-b border-slate-700 pb-2">Physical Params</h2>

            <div className="space-y-2">
                {/* 1. Environment */}
                <Accordion title="1. Environment" colorClass="text-slate-400">
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Ambient Temp" value={config.environment.ambient_temp} path={['environment', 'ambient_temp']} unit="K" />
                        <Field label="Ambient Pressure" value={config.environment.ambient_pressure} path={['environment', 'ambient_pressure']} unit="Pa" />
                    </div>
                </Accordion>

                {/* 2. Intake System */}
                <Accordion title="2. Intake System" colorClass="text-emerald-400" defaultOpen>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Duct Length" value={config.intake.inlet.duct_length} path={['intake', 'inlet', 'duct_length']} unit="mm" />
                            <Field label="Duct Diameter" value={config.intake.inlet.duct_diameter} path={['intake', 'inlet', 'duct_diameter']} unit="mm" />
                            <Field label="Plenum Volume" value={config.intake.plenum_vol} path={['intake', 'plenum_vol']} unit="L" />
                        </div>

                        <div className="border-t border-slate-700 pt-2">
                            <h4 className="text-xs font-bold text-slate-500 mb-2">Runners & ITB</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Length" value={config.intake.bellmouth.length} path={['intake', 'bellmouth', 'length']} unit="mm" />
                                <Field label="Diameter" value={config.intake.bellmouth.diameter} path={['intake', 'bellmouth', 'diameter']} unit="mm" />
                                <Field label="Taper" value={config.intake.bellmouth.taper_angle} path={['intake', 'bellmouth', 'taper_angle']} unit="deg" />
                            </div>
                        </div>

                        <div className="border-t border-slate-700 pt-2">
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="text-xs font-bold text-slate-500">ITB Config</h4>
                                <Checkbox label="Fitted" value={config.intake.itb.fitted} path={['intake', 'itb', 'fitted']} />
                            </div>
                            {config.intake.itb.fitted && (
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Diameter" value={config.intake.itb.diameter} path={['intake', 'itb', 'diameter']} unit="mm" />
                                    <Field label="Plate Thk" value={config.intake.itb.plate_thickness} path={['intake', 'itb', 'plate_thickness']} unit="mm" />
                                    <div className="col-span-2">
                                        <Field label="CD Map" value={config.intake.itb.discharge_coeff_map} path={['intake', 'itb', 'discharge_coeff_map']} type="text" />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </Accordion>

                {/* 3. Engine Core */}
                <Accordion title="3. Engine Core" colorClass="text-amber-400">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Bore" value={config.engine.geometry.bore} path={['engine', 'geometry', 'bore']} unit="mm" />
                            <Field label="Stroke" value={config.engine.geometry.stroke} path={['engine', 'geometry', 'stroke']} unit="mm" />
                            <Field label="Comp Ratio" value={config.engine.geometry.compression_ratio} path={['engine', 'geometry', 'compression_ratio']} />
                            <Field label="Rod Length" value={config.engine.geometry.rod_length} path={['engine', 'geometry', 'rod_length']} unit="mm" />
                        </div>

                        <div className="border-t border-slate-700 pt-2">
                            <h4 className="text-xs font-bold text-slate-500 mb-2">Combustion Model (Wiebe)</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Start Angle" value={config.engine.combustion.start_angle} path={['engine', 'combustion', 'start_angle']} unit="deg" />
                                <Field label="Duration" value={config.engine.combustion.duration} path={['engine', 'combustion', 'duration']} unit="deg" />
                                <Field label="Shape (m)" value={config.engine.combustion.shape_parameter_m} path={['engine', 'combustion', 'shape_parameter_m']} />
                                <Field label="Efficiency (a)" value={config.engine.combustion.efficiency_a} path={['engine', 'combustion', 'efficiency_a']} />
                                <Field label="Mass Burn (b)" value={config.engine.combustion.mass_burned_b} path={['engine', 'combustion', 'mass_burned_b']} />
                            </div>
                        </div>
                    </div>
                </Accordion>

                {/* 4. Head & Valvetrain */}
                <Accordion title="4. Head & Valvetrain" colorClass="text-purple-400">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Wall Temp" value={config.engine.head.wall_temp} path={['engine', 'head', 'wall_temp']} unit="K" />
                            <Field label="Port Flow Coeff" value={config.engine.head.port_flow_coeff} path={['engine', 'head', 'port_flow_coeff']} />
                            <Field label="Valves/Cyl" value={config.engine.head.valves_per_cyl} path={['engine', 'head', 'valves_per_cyl']} />
                            <Field label="Intake Bias" value={config.engine.vanos_intake_bias} path={['engine', 'vanos_intake_bias']} unit="deg" />
                        </div>

                        <div className="border-t border-slate-700 pt-2">
                            <h4 className="text-xs font-bold text-slate-500 mb-2">Intake Valve</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Max Lift" value={config.engine.head.intake_valve.max_lift} path={['engine', 'head', 'intake_valve', 'max_lift']} unit="mm" />
                                <Field label="Duration" value={config.engine.head.intake_valve.duration} path={['engine', 'head', 'intake_valve', 'duration']} unit="deg" />
                                <Field label="Profile" value={config.engine.head.intake_valve.lift_profile} path={['engine', 'head', 'intake_valve', 'lift_profile']} type="text" />
                            </div>
                        </div>

                        <div className="border-t border-slate-700 pt-2">
                            <h4 className="text-xs font-bold text-slate-500 mb-2">Exhaust Valve</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Max Lift" value={config.engine.head.exhaust_valve.max_lift} path={['engine', 'head', 'exhaust_valve', 'max_lift']} unit="mm" />
                                <Field label="Duration" value={config.engine.head.exhaust_valve.duration} path={['engine', 'head', 'exhaust_valve', 'duration']} unit="deg" />
                                <Field label="Profile" value={config.engine.head.exhaust_valve.lift_profile} path={['engine', 'head', 'exhaust_valve', 'lift_profile']} type="text" />
                            </div>
                        </div>
                    </div>
                </Accordion>

                {/* 5. Exhaust System */}
                <Accordion title="5. Exhaust System" colorClass="text-rose-400">
                    <div className="space-y-4">
                        {/* Headers */}
                        <div className="border-b border-slate-700 pb-2">
                            <h4 className="text-xs font-bold text-slate-500 mb-2">Headers</h4>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Prim Length" value={config.exhaust.headers.primary_length} path={['exhaust', 'headers', 'primary_length']} unit="mm" />
                                <Field label="Prim Dia" value={config.exhaust.headers.primary_diameter} path={['exhaust', 'headers', 'primary_diameter']} unit="mm" />
                                <Field label="Coll Count" value={config.exhaust.headers.collector_count} path={['exhaust', 'headers', 'collector_count']} />
                                <Field label="Coll Dia" value={config.exhaust.headers.collector_dia} path={['exhaust', 'headers', 'collector_dia']} unit="mm" />
                                <Field label="Wall Temp" value={config.exhaust.headers.wall_temp} path={['exhaust', 'headers', 'wall_temp']} unit="K" />
                                <Field label="Heat Coeff" value={config.exhaust.headers.heat_coeff} path={['exhaust', 'headers', 'heat_coeff']} />
                            </div>
                        </div>

                        {/* Section 1 */}
                        <div className="border-b border-slate-700 pb-2">
                            <h4 className="text-xs font-bold text-slate-500 mb-2">Section 1 (Cats/X-Pipe)</h4>
                            <div className="grid grid-cols-2 gap-3 mb-2">
                                <Field label="Length" value={config.exhaust.section1.length} path={['exhaust', 'section1', 'length']} unit="mm" />
                                <Field label="Diameter" value={config.exhaust.section1.diameter} path={['exhaust', 'section1', 'diameter']} unit="mm" />
                                <div className="col-span-2">
                                    <Field label="Layout" value={config.exhaust.section1.layout} path={['exhaust', 'section1', 'layout']} type="text" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <Checkbox label="Cat Fitted" value={config.exhaust.section1.cat_fitted} path={['exhaust', 'section1', 'cat_fitted']} />
                                <Field label="Cat Offset" value={config.exhaust.section1.cat_offset} path={['exhaust', 'section1', 'cat_offset']} unit="mm" />
                            </div>
                        </div>

                        {/* Section 2 */}
                        <div className="border-b border-slate-700 pb-2">
                            <h4 className="text-xs font-bold text-slate-500 mb-2">Section 2 (Resonator)</h4>
                            <div className="grid grid-cols-2 gap-3 mb-2">
                                <Field label="Length" value={config.exhaust.section2.length} path={['exhaust', 'section2', 'length']} unit="mm" />
                                <Field label="Diameter" value={config.exhaust.section2.diameter} path={['exhaust', 'section2', 'diameter']} unit="mm" />
                            </div>
                            <Checkbox label="Resonator" value={config.exhaust.section2.resonator_fitted} path={['exhaust', 'section2', 'resonator_fitted']} />
                        </div>

                        {/* Section 3 */}
                        <div>
                            <h4 className="text-xs font-bold text-slate-500 mb-2">Section 3 (Muffler)</h4>
                            <div className="grid grid-cols-2 gap-3 mb-2">
                                <Field label="Muffler Len" value={config.exhaust.section3.length} path={['exhaust', 'section3', 'length']} unit="mm" />
                                <Field label="Pipe Dia" value={config.exhaust.section3.diameter} path={['exhaust', 'section3', 'diameter']} unit="mm" />
                                <Field label="Tail Len" value={config.exhaust.section3.tailpipe_length} path={['exhaust', 'section3', 'tailpipe_length']} unit="mm" />
                                <div className="col-span-2">
                                    <Field label="Type" value={config.exhaust.section3.muffler_type} path={['exhaust', 'section3', 'muffler_type']} type="text" />
                                </div>
                            </div>
                        </div>
                    </div>
                </Accordion>
            </div>
        </div>
    );
};

export default PhysicalParamTuner;
