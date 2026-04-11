'use client';
import React, { useState, useRef } from 'react';
import { ShieldCheck, Upload, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
    WATERMARK_CHECK_FORM_FIELD,
    WATERMARK_CHECK_PROXY_PATH,
    WATERMARK_FILE_ACCEPT,
    isSupportedWatermarkFile,
} from './deepfakeFooterConfig';

export const DeepfakeFooterTool: React.FC = () => {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [result, setResult] = useState<{ message: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const resetFilePicker = () => {
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!isSupportedWatermarkFile(file)) {
            setResult(null);
            setError('Upload a 16-bit PCM WAV file to run the Voice-Flow authenticity check.');
            resetFilePicker();
            return;
        }

        setIsAnalyzing(true);
        setError(null);
        setResult(null);

        try {
            const formData = new FormData();
            formData.append(WATERMARK_CHECK_FORM_FIELD, file);

            const response = await fetch(WATERMARK_CHECK_PROXY_PATH, {
                method: 'POST',
                body: formData,
            });

            const data = await response.json().catch(() => ({} as Record<string, unknown>));

            if (!response.ok || !data.ok) {
                throw new Error(String(data.error || data.detail || 'Authenticity check failed. Upload a supported WAV export and try again.'));
            }

            if (data.detected) {
                setResult({
                    message: String(data.message || 'Voice-Flow watermark detected.')
                });
            } else {
                setError(String(data.message || 'No Voice-Flow watermark was detected in this WAV export.'));
            }
        } catch (err: unknown) {
            setError(String((err as Error)?.message || 'Authenticity check failed. Please ensure the file is a valid WAV export.'));
        } finally {
            setIsAnalyzing(false);
            resetFilePicker();
        }
    };

    return (
        <div className="mt-12 rounded-3xl border border-indigo-500/20 bg-slate-950/40 p-6 backdrop-blur-md lg:p-8">
            <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
                <div className="max-w-md">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                        <ShieldCheck className="text-indigo-400" size={24} />
                        Voice authenticity check
                    </h3>
                    <p className="mt-2 text-sm text-slate-400">
                        Upload a 16-bit PCM WAV export to verify whether a Voice-Flow authenticity watermark is present.
                    </p>
                    <p className="mt-2 text-xs leading-6 text-slate-500">
                        This tool confirms Voice-Flow watermark presence only. It does not identify a speaker, prove ownership, or grant permission to use the audio.
                    </p>
                </div>

                <div className="w-full shrink-0 lg:w-auto">
                    {!result && !error && !isAnalyzing && (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-4 font-bold text-white transition hover:bg-indigo-500 lg:w-auto"
                        >
                            <Upload size={18} />
                            Upload WAV for Check
                        </button>
                    )}

                    {isAnalyzing && (
                        <div className="flex items-center gap-3 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 px-6 py-4 text-indigo-200">
                            <Loader2 className="animate-spin" size={18} />
                            Checking Voice-Flow watermark...
                        </div>
                    )}

                    {result && (
                        <div className="flex flex-col gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 animate-in fade-in zoom-in duration-300">
                            <div className="flex items-center gap-2 font-bold text-emerald-400">
                                <CheckCircle2 size={18} />
                                Authenticity confirmed
                            </div>
                            <p className="text-sm leading-6 text-emerald-50">{result.message}</p>
                            <p className="text-xs leading-6 text-emerald-100/70">
                                Review consent, rights, and speaker authorization separately before reusing or distributing the audio.
                            </p>
                            <button 
                                onClick={() => setResult(null)}
                                className="text-center text-[10px] font-bold uppercase tracking-wider text-emerald-400/60 hover:text-emerald-400"
                            >
                                Check another file
                            </button>
                        </div>
                    )}

                    {error && (
                        <div className="flex flex-col gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 animate-in fade-in">
                            <div className="flex items-center gap-2 font-bold text-rose-400">
                                <AlertCircle size={18} />
                                Analysis Failed
                            </div>
                            <p className="text-xs text-rose-300/80">{error}</p>
                            <button 
                                onClick={() => setError(null)}
                                className="mt-2 text-left text-[10px] font-bold uppercase tracking-wider text-rose-400"
                            >
                                Try again
                            </button>
                        </div>
                    )}
                </div>
            </div>
            
            <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleUpload} 
                accept={WATERMARK_FILE_ACCEPT}
                className="hidden" 
            />
        </div>
    );
};
