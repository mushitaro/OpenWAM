
import React, { useState } from "react";
import { Upload, Download, Save, FileCode, CheckCircle, AlertCircle } from "lucide-react";
import { uploadBinary, patchBinary, downloadBinary } from "../app/api";

interface BinaryPatchManagerProps {
    optimizationResult: { best_bias: number, max_ve: number } | null;
}

const BinaryPatchManager: React.FC<BinaryPatchManagerProps> = ({ optimizationResult }) => {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [patching, setPatching] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error", text: string } | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setMessage(null);
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        try {
            await uploadBinary(file);
            setMessage({ type: "success", text: "Binary uploaded successfully!" });
        } catch (error) {
            setMessage({ type: "error", text: "Upload failed." });
        } finally {
            setUploading(false);
        }
    };

    const handlePatch = async () => {
        if (!optimizationResult) return;
        setPatching(true);
        try {
            await patchBinary(optimizationResult);
            setMessage({ type: "success", text: `Binary patched! Applied ${optimizationResult.best_bias > 0 ? "+" : ""}${optimizationResult.best_bias}° Intake VANOS Bias.` });
        } catch (error) {
            setMessage({ type: "error", text: "Patch failed." });
        } finally {
            setPatching(false);
        }
    };

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const blob = await downloadBinary();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "MSS54HP_CSL_Optimized.bin";
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            setMessage({ type: "error", text: "Download failed." });
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg">
            <div className="flex items-center gap-2 mb-6 text-purple-400">
                <FileCode size={24} />
                <h2 className="text-xl font-bold">Binary Patcher</h2>
            </div>

            <div className="space-y-6">
                {/* Step 1: Upload */}
                <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                    <h3 className="text-slate-300 font-bold mb-2 flex items-center gap-2">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-700 text-xs">1</span>
                        Upload Stock Binary
                    </h3>
                    <div className="flex gap-4 items-center">
                        <input
                            type="file"
                            accept=".bin"
                            onChange={handleFileChange}
                            className="block w-full text-sm text-slate-400
                                file:mr-4 file:py-2 file:px-4
                                file:rounded-full file:border-0
                                file:text-sm file:font-semibold
                                file:bg-slate-700 file:text-slate-200
                                hover:file:bg-slate-600
                            "
                        />
                        <button
                            onClick={handleUpload}
                            disabled={!file || uploading}
                            className={`p-2 rounded-lg transition-colors ${!file ? "opacity-50 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500 text-white"}`}
                        >
                            {uploading ? <div className="animate-spin h-5 w-5 border-2 border-white rounded-full border-t-transparent" /> : <Upload size={20} />}
                        </button>
                    </div>
                </div>

                {/* Step 2: Review Optimization */}
                <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                    <h3 className="text-slate-300 font-bold mb-2 flex items-center gap-2">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-700 text-xs">2</span>
                        Apply Optimization
                    </h3>
                    {optimizationResult ? (
                        <div className="flex items-center justify-between">
                            <div className="text-sm text-slate-400">
                                Best Intake Bias: <span className="text-emerald-400 font-bold">{optimizationResult.best_bias}°</span>
                            </div>
                            <button
                                onClick={handlePatch}
                                disabled={patching}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold transition-transform active:scale-95 disabled:opacity-50"
                            >
                                {patching ? "Patching..." : <><Save size={18} /> Apply Patch</>}
                            </button>
                        </div>
                    ) : (
                        <div className="text-sm text-slate-500 italic flex items-center gap-2">
                            <AlertCircle size={16} />
                            Run "Auto-Optimize Tune" first to ascertain optimal values.
                        </div>
                    )}
                </div>

                {/* Step 3: Download */}
                <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                    <h3 className="text-slate-300 font-bold mb-2 flex items-center gap-2">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-700 text-xs">3</span>
                        Download Result
                    </h3>
                    <button
                        onClick={handleDownload}
                        disabled={downloading}
                        className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                        {downloading ? "Downloading..." : <><Download size={18} /> Download Optimized Binary</>}
                    </button>
                </div>
            </div>

            {message && (
                <div className={`mt-6 p-4 rounded-lg flex items-center gap-3 ${message.type === "success" ? "bg-emerald-900/30 text-emerald-400 border border-emerald-800" : "bg-red-900/30 text-red-400 border border-red-800"}`}>
                    {message.type === "success" ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
                    {message.text}
                </div>
            )}
        </div>
    );
};

export default BinaryPatchManager;
