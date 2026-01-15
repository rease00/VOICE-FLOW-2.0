

import React, { useState, useRef, useEffect } from 'react';
import { 
    Mic, User, Play, Pause, Settings, X, Server, Wand2, Trash2, Sparkles, 
    Music, Video, History, ArrowRight, Languages, Globe, FolderOpen, Square, 
    Save, FileText, Fingerprint, UploadCloud, FileAudio, Disc, Loader2, 
    AlertCircle, Download, CheckCircle2, LogOut, Menu, ChevronRight, Box, Radio,
    Plus, Bot, Layers, SpellCheck, Volume2, Clock, MessageSquare, Send, 
    Film, MonitorPlay, SplitSquareHorizontal, Volume1, VolumeX, Clapperboard, Mic2, Sliders,
    Key, Lock, Terminal, RefreshCw, Users, Edit2, Palette, Timer, Cpu, Minimize2, Maximize2, Type, Zap, Laptop, Activity, BookOpenCheck, Feather, Book, Filter, Search, BookOpen
} from 'lucide-react';
import { Button } from '../components/Button';
import { VOICES, MUSIC_TRACKS, LANGUAGES, EMOTIONS, OPENAI_VOICES, F5_VOICES } from '../constants';
import { GenerationSettings, AppScreen, HistoryItem, ClonedVoice, RemoteSpeaker, DubSegment, CharacterProfile, VoiceOption } from '../types';
import { generateSpeech, audioBufferToWav, generateTextContent, translateText, analyzeVoiceSample, translateVideoContent, detectLanguage, parseMultiSpeakerScript, extractAudioFromVideo, autoFormatScript, autoCorrectText, proofreadScript, fetchRemoteSpeakers, DirectorOptions, parseScriptToSegments, getAudioContext, localizeNovel } from '../services/geminiService';
import { isolateBackgroundTrack, mixFinalDub } from '../services/dubbingService';
import { AudioPlayer } from '../components/AudioPlayer';
import { useUser } from '../contexts/UserContext';
import { AdModal } from '../components/AdModal';
import { f5OnnxEngine } from '../services/f5OnnxService';

interface MainAppProps {
  setScreen: (screen: AppScreen) => void;
}

enum Tab {
  STUDIO = 'STUDIO',
  LAB = 'LAB',
  DUBBING = 'DUBBING',
  CHARACTERS = 'CHARACTERS',
  NOVEL = 'NOVEL'
}

type LabMode = 'CLONING' | 'COVERS';

const Toast = ({ message, type, onClose }: { message: string, type: 'success' | 'error' | 'info', onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const styles = {
    success: 'bg-green-50 text-green-800 border-green-100',
    error: 'bg-red-50 text-red-800 border-red-100',
    info: 'bg-blue-50 text-blue-800 border-blue-100'
  };

  return (
    <div className={`fixed top-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border animate-in slide-in-from-right ${styles[type]}`}>
      {type === 'success' && <CheckCircle2 size={16} />}
      {type === 'error' && <AlertCircle size={16} />}
      {type === 'info' && <Sparkles size={16} />}
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="opacity-50 hover:opacity-100 ml-2"><X size={14} /></button>
    </div>
  );
};

// --- SYSTEM RESOURCE MONITOR ---
const ResourceMonitor = ({ isWorking }: { isWorking: boolean }) => {
  const [stats, setStats] = useState({ cpu: 0, ram: 0, gpu: 'Unknown GPU' });

  useEffect(() => {
    // 1. Get GPU Renderer Name (Once)
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        if (gl) {
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                // Clean up renderer string
                const cleanName = renderer.replace(/ANGLE \((.*)\)/, '$1').replace(/Direct3D11 vs_.* ps_.*/, '').substring(0, 20);
                setStats(s => ({ ...s, gpu: cleanName }));
            }
        }
    } catch(e) {}

    const interval = setInterval(() => {
        // 2. RAM Usage (Chrome only)
        const mem = (performance as any).memory;
        const ramUsage = mem ? Math.round(mem.usedJSHeapSize / 1024 / 1024) : 0;

        // 3. CPU Simulation
        // We can't get real CPU load in JS, so we simulate based on "isWorking" + randomness
        let targetCpu = isWorking ? 65 : 5; 
        const fluctuation = Math.random() * 10 - 5;
        
        setStats(prev => {
            const currentCpu = prev.cpu;
            const drift = (targetCpu + fluctuation) - currentCpu;
            return {
                ...prev,
                ram: ramUsage,
                cpu: Math.max(1, Math.min(100, Math.round(currentCpu + (drift * 0.1))))
            };
        });

    }, 1000);

    return () => clearInterval(interval);
  }, [isWorking]);

  return (
    <div className="fixed bottom-4 left-64 ml-6 z-40 hidden md:flex items-center gap-4 bg-white/80 backdrop-blur-md px-4 py-2 rounded-full border border-gray-200 shadow-sm text-[10px] font-mono text-gray-500">
        <div className="flex items-center gap-1.5" title="Simulated CPU Load">
            <Activity size={12} className={isWorking ? "text-amber-500 animate-pulse" : "text-gray-400"} />
            <span>CPU: {stats.cpu}%</span>
        </div>
        <div className="w-px h-3 bg-gray-300"></div>
        <div className="flex items-center gap-1.5" title="JS Heap Usage">
            <Cpu size={12} className="text-gray-400" />
            <span>RAM: {stats.ram > 0 ? `${stats.ram} MB` : 'N/A'}</span>
        </div>
        <div className="w-px h-3 bg-gray-300"></div>
        <div className="flex items-center gap-1.5" title="Active GPU Renderer">
            <Zap size={12} className={isWorking ? "text-violet-500" : "text-gray-400"} />
            <span className="truncate max-w-[120px]">{stats.gpu}</span>
        </div>
    </div>
  );
};

// --- Generation Widget (Compact) ---
const GenerationWidget = ({ 
    progress, 
    timeLeft, 
    stage, 
    onCancel 
}: { 
    progress: number, 
    timeLeft: number, 
    stage: string, 
    onCancel?: () => void 
}) => {
    return (
        <div className="fixed bottom-6 left-6 z-[60] w-80 bg-[#0f172a] border border-indigo-500/30 rounded-2xl shadow-2xl shadow-indigo-500/20 p-4 overflow-hidden animate-in slide-in-from-bottom-10 fade-in group">
            {/* Animated Background Glow */}
            <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent animate-spin-slow pointer-events-none"></div>
            
            <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                         <div className="w-8 h-8 relative">
                            <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20"></div>
                            <div className="absolute inset-0 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Cpu className="text-white animate-pulse" size={14} />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white">Generating Audio</h3>
                            <p className="text-[10px] text-indigo-300 font-medium animate-pulse">{stage}</p>
                        </div>
                    </div>
                    {onCancel && (
                        <button 
                            onClick={onCancel}
                            className="p-1.5 rounded-full bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors border border-transparent hover:border-red-500/30"
                            title="Cancel Generation"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-800 rounded-full h-1.5 mb-3 overflow-hidden border border-gray-700">
                    <div 
                        className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-300 ease-out relative"
                        style={{ width: `${progress}%` }}
                    >
                         <div className="absolute inset-0 bg-white/20 w-full h-full animate-[shimmer_2s_infinite]"></div>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="flex items-center justify-between w-full text-[10px] font-mono text-gray-400 bg-gray-900/50 p-2 rounded-lg border border-gray-800">
                    <span className="text-white font-bold flex items-center gap-1">
                        <Timer size={10} /> {timeLeft > 0 ? `${timeLeft}s` : '...'}
                    </span>
                    <span className="text-white font-bold">{Math.round(progress)}%</span>
                </div>
            </div>
        </div>
    );
};

export const MainApp: React.FC<MainAppProps> = ({ setScreen }) => {
  const { stats, updateStats, setShowSubscriptionModal, addToHistory, history, user, clonedVoices, addClonedVoice, drafts, saveDraft, deleteDraft, characterLibrary, updateCharacter, deleteCharacter, getVoiceForCharacter, deleteAccount, syncCast } = useUser();
  
  // --- State ---
  const [activeTab, setActiveTab] = useState<Tab>(Tab.STUDIO);
  const [labMode, setLabMode] = useState<LabMode>('CLONING');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Studio Text State
  const [text, setText] = useState('');
  
  // Settings State
  const [settings, setSettings] = useState<GenerationSettings>(() => {
    try {
      const saved = localStorage.getItem('vf_settings');
      return saved ? JSON.parse(saved) : {
        voiceId: VOICES[0].id, speed: 1.0, pitch: 'Medium', language: 'Auto', emotion: 'Neutral',
        engine: 'GEM', backendUrl: '', chatterboxId: '', openaiModel: 'openedai-speech-bilingual-tts-1',
        helperProvider: 'GEMINI', perplexityApiKey: '', localLlmUrl: 'http://localhost:5000', geminiApiKey: '',
        musicTrackId: 'm_none', musicVolume: 0.3, speechVolume: 1.0, autoEnhance: true, speakerMapping: {},
        enableWebGpu: false
      };
    } catch { return {}; }
  });

  useEffect(() => { localStorage.setItem('vf_settings', JSON.stringify(settings)); }, [settings]);

  const [coquiSpeakers, setCoquiSpeakers] = useState<RemoteSpeaker[]>([]);
  const [isFetchingSpeakers, setIsFetchingSpeakers] = useState(false);
  
  // Generation Status State
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [processingStage, setProcessingStage] = useState('');
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  
  // Abort Controller for Cancellation
  const generationAbortController = useRef<AbortController | null>(null);
  
  // Modals & Overlays
  const [showSettings, setShowSettings] = useState(false);
  const [showAdModal, setShowAdModal] = useState(false);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error' | 'info'} | null>(null);

  // Editor Tools
  const [isAiWriting, setIsAiWriting] = useState(false);
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [detectedSpeakers, setDetectedSpeakers] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Translation & Chat State
  const [targetLang, setTargetLang] = useState('Hinglish');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'ai', text: string}[]>([
      { role: 'ai', text: "Hello! I'm your creative assistant. I can help you write, edit, or direct your video." }
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Lab & Dubbing State
  const [cloneMode, setCloneMode] = useState<'record' | 'upload'>('record');
  const [isRecording, setIsRecording] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [uploadVoiceFile, setUploadVoiceFile] = useState<File | null>(null);
  
  // --- Video Dubbing State ---
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [dubScript, setDubScript] = useState('');
  const [dubAudioUrl, setDubAudioUrl] = useState<string | null>(null);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false);
  const [isPlayingDub, setIsPlayingDub] = useState(false);
  const [directorOptions, setDirectorOptions] = useState<DirectorOptions>({
      style: 'natural',
      tone: 'neutral'
  });
  
  // Mixing
  const [videoVolume, setVideoVolume] = useState(1.0);
  const [dubVolume, setDubVolume] = useState(1.0);

  // --- Character Management State ---
  const [charTab, setCharTab] = useState<'CAST' | 'GALLERY'>('CAST');
  const [voiceSearch, setVoiceSearch] = useState('');
  const [voiceFilterGender, setVoiceFilterGender] = useState<'All' | 'Male' | 'Female'>('All');
  const [voiceFilterAccent, setVoiceFilterAccent] = useState<string>('All');

  const [characterModalOpen, setCharacterModalOpen] = useState(false);
  const [editingChar, setEditingChar] = useState<CharacterProfile | null>(null);
  const [charForm, setCharForm] = useState<CharacterProfile>({
      id: '', name: '', voiceId: VOICES[0].id, gender: 'Unknown', age: 'Adult', avatarColor: '#6366f1'
  });

  // --- Novel Adapter State ---
  const [novelInput, setNovelInput] = useState('');
  const [novelOutput, setNovelOutput] = useState('');
  const [novelTargetLang, setNovelTargetLang] = useState('Hinglish');
  const [novelTargetCulture, setNovelTargetCulture] = useState('');
  const [novelAdaptationMode, setNovelAdaptationMode] = useState<'translate' | 'adapt'>('adapt');
  const [isAdaptingNovel, setIsAdaptingNovel] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const dubAudioRef = useRef<HTMLAudioElement>(null);
  const progressTimerRef = useRef<any>(null);

  // --- PREVIEW STATE ---
  const [previewState, setPreviewState] = useState<{ id: string, status: 'loading' | 'playing' } | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const isLimitReached = stats.generationsUsed >= stats.generationsLimit && !stats.isPremium;
  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => setToast({ msg, type });

  // --- Effects ---

  useEffect(() => {
      if (isChatOpen && chatEndRef.current) {
          chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
  }, [chatHistory, isChatOpen]);

  // Cleanup timer on unmount
  useEffect(() => {
      return () => { 
          if(progressTimerRef.current) clearInterval(progressTimerRef.current);
          if(previewAudioRef.current) previewAudioRef.current.pause();
          if(generationAbortController.current) generationAbortController.current.abort();
      }
  }, []);

  // Auto-detect Coqui connection on load if set
  useEffect(() => {
    if (settings.engine === 'COQ' && settings.backendUrl && coquiSpeakers.length === 0) {
       checkBackendConnection();
    }
  }, [settings.engine]);

  // Auto-detect language and speakers in text (Studio Mode AND Dubbing Mode)
  useEffect(() => {
    const textToAnalyze = activeTab === Tab.STUDIO ? text : (activeTab === Tab.DUBBING ? dubScript : '');
    if (!textToAnalyze) return;

    const timeoutId = setTimeout(async () => {
      if (textToAnalyze.length > 5 && settings.language === 'Auto') {
        const code = await detectLanguage(textToAnalyze, settings);
        setDetectedLang(code.toUpperCase());
      } else {
        setDetectedLang(null);
      }

      const { isMultiSpeaker, speakersList } = parseMultiSpeakerScript(textToAnalyze);
      if (isMultiSpeaker && speakersList.length > 0) {
        setDetectedSpeakers(speakersList);
        
        // --- AUTO SYNC CAST TO LIBRARY ---
        syncCast(speakersList);

        // Auto-update settings from Character Library Memory
        setSettings(prev => {
            const newMapping = { ...prev.speakerMapping };
            let changed = false;
            speakersList.forEach((speaker, idx) => {
                const rememberedVoiceId = getVoiceForCharacter(speaker);
                if (rememberedVoiceId) {
                    if (newMapping[speaker] !== rememberedVoiceId) {
                        newMapping[speaker] = rememberedVoiceId;
                        changed = true;
                    }
                } else if (!newMapping[speaker]) {
                    // Temporary Fallback based on engine
                    let fallbackId = 'v1';
                    if (prev.engine === 'COQ' && coquiSpeakers.length > 0) fallbackId = coquiSpeakers[idx % coquiSpeakers.length].id;
                    else if (prev.engine === 'OPENAI') fallbackId = OPENAI_VOICES[idx % OPENAI_VOICES.length].id;
                    else if (prev.engine === 'F5') fallbackId = F5_VOICES[idx % F5_VOICES.length].id;
                    else fallbackId = VOICES[idx % VOICES.length].id;

                    newMapping[speaker] = fallbackId;
                    changed = true;
                }
            });
            return changed ? { ...prev, speakerMapping: newMapping } : prev;
        });
      } else {
        setDetectedSpeakers([]);
      }
    }, 1500); 
    return () => clearTimeout(timeoutId);
  }, [text, dubScript, settings.language, settings.engine, coquiSpeakers, activeTab, characterLibrary]);

  // Video Playback Sync
  useEffect(() => {
    const video = videoRef.current;
    const audio = dubAudioRef.current;
    
    if (video && audio) {
        const handlePlay = () => {
            if (video.readyState >= 2 && audio.readyState >= 2) {
                 video.play().catch(e => console.error("Video play fail", e));
                 audio.play().catch(e => console.error("Audio play fail", e));
                 setIsPlayingDub(true);
            }
        };
        const handlePause = () => {
            video.pause();
            audio.pause();
            setIsPlayingDub(false);
        };
        const handleSeek = () => {
            const drift = Math.abs(audio.currentTime - video.currentTime);
            if (drift > 0.1) {
                audio.currentTime = video.currentTime;
            }
        };
        const handleEnded = () => {
            setIsPlayingDub(false);
            video.currentTime = 0;
            audio.currentTime = 0;
            video.pause();
            audio.pause();
        };

        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        video.addEventListener('seeking', handleSeek);
        video.addEventListener('ended', handleEnded);
        audio.addEventListener('ended', handleEnded);

        return () => {
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('seeking', handleSeek);
            video.removeEventListener('ended', handleEnded);
            audio.removeEventListener('ended', handleEnded);
        };
    }
  }, [dubAudioUrl, videoUrl]);

  useEffect(() => {
      if (videoRef.current) videoRef.current.volume = videoVolume;
      if (dubAudioRef.current) dubAudioRef.current.volume = dubVolume;
  }, [videoVolume, dubVolume]);


  // --- Logic Functions ---

  // Helper to start simulated progress
  const startSimulation = (estSeconds: number, startMsg: string) => {
     if (progressTimerRef.current) clearInterval(progressTimerRef.current);
     
     setProgress(0);
     setTimeLeft(estSeconds);
     setProcessingStage(startMsg);
     setIsGenerating(true);

     const increment = 100 / (estSeconds * 10); // update every 100ms
     
     progressTimerRef.current = setInterval(() => {
         setProgress(prev => {
             if (prev >= 90) return 90; // Stall at 90% until real completion
             return prev + increment;
         });
         setTimeLeft(prev => Math.max(0, prev - 0.1)); // inaccurate but visual
     }, 100);
  };

  const stopSimulation = () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      setProgress(100);
      setTimeLeft(0);
      // Short delay to show 100% before closing
      setTimeout(() => {
          setIsGenerating(false);
          setProgress(0);
      }, 500);
  };
  
  const handleCancelGeneration = () => {
      if (generationAbortController.current) {
          generationAbortController.current.abort();
          generationAbortController.current = null;
      }
      stopSimulation();
      showToast("Generation Cancelled", "info");
  };

  const checkBackendConnection = async () => {
    const rawUrl = settings.backendUrl?.trim();
    if (!rawUrl) return showToast("Enter Backend URL first", "info");
    const cleanUrl = rawUrl.replace(/\/$/, ''); 

    // Don't fetch speakers for OpenAI/F5/Local engine
    if (settings.engine === 'OPENAI' || settings.engine === 'F5' || settings.engine === 'LOCAL_WEBGPU') {
         setSettings(s => ({ ...s, backendUrl: cleanUrl }));
         showToast(`URL Saved. Using ${settings.engine} presets.`, "success");
         return;
    }

    setIsFetchingSpeakers(true);
    try {
        const speakers = await fetchRemoteSpeakers(cleanUrl);
        setCoquiSpeakers(speakers);
        showToast(`Connected! ${speakers.length} voices found.`, 'success');
        if (speakers.length > 0) {
            setSettings(s => ({ ...s, chatterboxId: speakers[0].id, backendUrl: cleanUrl }));
        } else {
             setSettings(s => ({ ...s, backendUrl: cleanUrl }));
        }
    } catch (e: any) {
        showToast(`Connection Failed: ${e.message}`, "error");
        setCoquiSpeakers([]);
    } finally {
        setIsFetchingSpeakers(false);
    }
  };

  const performGeneration = async (scriptText: string, signal?: AbortSignal) => {
      if (!scriptText.trim()) throw new Error("Text is empty");
      
      // Auto-Add Characters to Library before generation
      if (detectedSpeakers.length > 0) {
          syncCast(detectedSpeakers);
      }

      // Handle Local Engine Loading UI
      if (settings.engine === 'LOCAL_WEBGPU') {
          setProcessingStage("Initializing On-Device Model (WebGPU)...");
          try {
             // Trigger load model with progress callback
             await f5OnnxEngine.loadModel((data) => {
                 if (data.status === 'progress' && data.progress) {
                     const percent = Math.round(data.progress);
                     setProcessingStage(`Downloading Model: ${percent}%`);
                     setProgress(percent); // Sync progress bar
                 }
                 if (data.status === 'ready') setProcessingStage("Model Loaded. Synthesizing...");
             });
          } catch(e) {
              throw new Error("Failed to load local model. Check browser compatibility.");
          }
      }
      
      let voiceId = settings.engine === 'COQ' ? settings.chatterboxId : settings.voiceId;
      
      let voiceNameDisplay = "AI Voice";
      if (settings.engine === 'COQ') {
          const v = coquiSpeakers.find(s => s.id === voiceId);
          voiceNameDisplay = v?.name || 'Coqui Voice';
      } else if (settings.engine === 'OPENAI') {
          const v = OPENAI_VOICES.find(v => v.id === voiceId);
          voiceNameDisplay = v?.name || voiceId;
      } else if (settings.engine === 'F5') {
          const v = F5_VOICES.find(v => v.id === voiceId) || clonedVoices.find(v => v.id === voiceId);
          voiceNameDisplay = v?.name || 'F5 Clone';
      } else if (settings.engine === 'LOCAL_WEBGPU') {
          voiceNameDisplay = "On-Device";
      } else {
          const v = VOICES.find(v => v.id === voiceId) || clonedVoices.find(v => v.id === voiceId);
          voiceNameDisplay = v?.name || 'Gemini Voice';
      }

      let geminiVoiceName = 'Fenrir';
      if (settings.engine === 'COQ' || settings.engine === 'OPENAI' || settings.engine === 'F5' || settings.engine === 'LOCAL_WEBGPU') {
          geminiVoiceName = voiceId;
      } else {
          geminiVoiceName = VOICES.find(v => v.id === voiceId)?.geminiVoiceName || clonedVoices.find(v => v.id === voiceId)?.geminiVoiceName || 'Fenrir';
      }

      // Pass signal to generateSpeech
      const audioBuffer = await generateSpeech(scriptText, geminiVoiceName, settings, 'speech', signal);
      const wavBlob = audioBufferToWav(audioBuffer);
      const url = URL.createObjectURL(wavBlob);
      
      if (!stats.isPremium) updateStats({ generationsUsed: stats.generationsUsed + 1 });
      
      return { url, voiceNameDisplay };
  };

  const handleGenerate = async () => {
    if (!text.trim()) return showToast("Please enter some text.", "info");
    if (isLimitReached) return setShowAdModal(true);
    
    // Setup Abort Controller
    if (generationAbortController.current) generationAbortController.current.abort();
    const controller = new AbortController();
    generationAbortController.current = controller;
    
    setGeneratedAudioUrl(null);
    
    // Calculate Estimate
    // TTS Speed is roughly 20 chars per second generation for cloud
    const estTime = Math.max(3, Math.ceil(text.length / 20));
    startSimulation(estTime, "Synthesizing Voice...");

    try {
      const { url, voiceNameDisplay } = await performGeneration(text, controller.signal);
      setGeneratedAudioUrl(url);

      addToHistory({
        id: Date.now().toString(),
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        audioUrl: url,
        voiceName: detectedSpeakers.length > 0 ? `Cast (${detectedSpeakers.length})` : voiceNameDisplay,
        timestamp: Date.now()
      });

      showToast("Audio Generated!", "success");
    } catch (e: any) {
      if (e.name === 'AbortError') {
          // Cancelled cleanly
      } else {
          showToast(e.message, "error");
      }
    } finally {
      stopSimulation();
      generationAbortController.current = null;
    }
  };

  // --- Character Management Logic ---
  const openCharacterModal = (char?: CharacterProfile, presetVoiceId?: string) => {
      if (char) {
          setEditingChar(char);
          setCharForm(char);
      } else {
          setEditingChar(null);
          // Auto-color assignment
          const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e'];
          const randomColor = colors[Math.floor(Math.random() * colors.length)];
          
          setCharForm({
              id: Date.now().toString(),
              name: '',
              voiceId: presetVoiceId || VOICES[0].id,
              gender: 'Unknown',
              age: 'Adult',
              avatarColor: randomColor
          });
      }
      setCharacterModalOpen(true);
  };

  const saveCharacter = () => {
      if (!charForm.name.trim()) return showToast("Character Name required", "error");
      updateCharacter(charForm);
      setCharacterModalOpen(false);
      showToast(editingChar ? "Character Updated" : "Character Added", "success");
  };

  const deleteChar = (id: string) => {
      if (confirm("Delete this character?")) {
          deleteCharacter(id);
          showToast("Character Deleted", "info");
      }
  };

  // --- VOICE PREVIEW LOGIC ---
  const handleVoicePreview = async (voiceId: string, name: string) => {
      // Determine Engine & Config based on ID to correctly test the voice
      let engine: GenerationSettings['engine'] = 'GEM';
      let effectiveVoiceName = 'Fenrir';
      let chatterboxId = '';
  
      const isCoqui = coquiSpeakers.find(v => v.id === voiceId);
      const isOpenAI = OPENAI_VOICES.find(v => v.id === voiceId);
      const isF5 = F5_VOICES.find(v => v.id === voiceId);
      const isStandard = VOICES.find(v => v.id === voiceId);
      const isClone = clonedVoices.find(v => v.id === voiceId);
  
      // Priority Logic - Must match generation logic
      if (isCoqui) { engine = 'COQ'; chatterboxId = voiceId; effectiveVoiceName = isCoqui.name; }
      else if (isOpenAI) { engine = 'OPENAI'; chatterboxId = voiceId; effectiveVoiceName = isOpenAI.name; }
      else if (isF5) { engine = 'F5'; effectiveVoiceName = isF5.name; }
      else if (isStandard) { engine = 'GEM'; effectiveVoiceName = isStandard.geminiVoiceName; }
      else if (isClone) { engine = 'GEM'; effectiveVoiceName = isClone.geminiVoiceName; } // Default clones to Gemini for now
      else { effectiveVoiceName = 'Fenrir'; }
  
      await playVoiceSample(voiceId, name, engine, chatterboxId);
  };

  const playVoiceSample = async (voiceId: string, name: string, engine: GenerationSettings['engine'] = 'GEM', chatterboxId: string = '') => {
      // Stop current
      if (previewAudioRef.current) {
          previewAudioRef.current.pause();
          previewAudioRef.current = null;
      }
      
      // Toggle off if clicking same
      if (previewState?.id === voiceId && previewState.status === 'playing') {
          setPreviewState(null);
          return;
      }

      setPreviewState({ id: voiceId, status: 'loading' });

      try {
          // Fallback checks
          if ((engine === 'COQ' || engine === 'OPENAI' || engine === 'F5') && !settings.backendUrl) {
              throw new Error("Connect to Backend in settings first.");
          }

          const previewSettings: GenerationSettings = {
              ...settings,
              engine,
              voiceId: engine === 'GEM' ? voiceId : settings.voiceId,
              chatterboxId: engine !== 'GEM' ? chatterboxId : settings.chatterboxId, 
              speed: 1.0,
              emotion: 'Neutral'
          };

          const text = `Hello! I am ${name}. I can bring your story to life.`;
          
          // Use the correct voice name parameter expected by generateSpeech
          let voiceParam = name;
          if (engine === 'GEM') voiceParam = VOICES.find(v => v.id === voiceId)?.geminiVoiceName || 'Fenrir';
          else voiceParam = voiceId;

          const buffer = await generateSpeech(text, voiceParam, previewSettings, 'speech');
          const blob = audioBufferToWav(buffer);
          const url = URL.createObjectURL(blob);
          
          const audio = new Audio(url);
          previewAudioRef.current = audio;
          audio.volume = 1.0;
          
          audio.onended = () => {
              setPreviewState(null);
              URL.revokeObjectURL(url);
          };
          
          await audio.play();
          setPreviewState({ id: voiceId, status: 'playing' });

      } catch (e: any) {
          showToast(e.message, 'error');
          setPreviewState(null);
      }
  };

  const handlePreviewCharacter = async (char: CharacterProfile) => {
     // Auto-detect engine for existing characters based on ID patterns or list membership
     let engine: GenerationSettings['engine'] = 'GEM';
     const vid = char.voiceId;
     
     if (coquiSpeakers.some(v => v.id === vid)) engine = 'COQ';
     else if (OPENAI_VOICES.some(v => v.id === vid)) engine = 'OPENAI';
     else if (F5_VOICES.some(v => v.id === vid)) engine = 'F5';
     
     await playVoiceSample(char.voiceId, char.name, engine, vid);
  };


  // --- Video Dubbing Functions ---

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          setVideoFile(file);
          setVideoUrl(URL.createObjectURL(file));
          setDubScript('');
          setDubAudioUrl(null);
      }
  };

  const handleTranslateVideo = async (mode: 'transcribe' | 'translate' = 'transcribe') => {
      if (!videoFile) return showToast("Upload a video first", "info");
      setIsProcessingVideo(true);
      try {
          const lang = mode === 'translate' ? targetLang : 'Original';
          const translation = await translateVideoContent(videoFile, lang, settings);
          setDubScript(translation);
          showToast(mode === 'translate' ? "Translation Complete!" : "Transcription Complete!", "success");
      } catch (e: any) {
          showToast(e.message, "error");
      } finally {
          setIsProcessingVideo(false);
      }
  };

  const handleGenerateDub = async () => {
      if (!dubScript) return showToast("Generate a script first", "info");
      if (isLimitReached) return setShowAdModal(true);

      // Setup Abort Controller
      if (generationAbortController.current) generationAbortController.current.abort();
      const controller = new AbortController();
      generationAbortController.current = controller;

      // 1. Auto-Add Characters
      const { speakersList } = parseMultiSpeakerScript(dubScript);
      if (speakersList.length > 0) syncCast(speakersList);

      // 2. Parse Script & Estimate
      const segmentsRaw = parseScriptToSegments(dubScript);
      if (segmentsRaw.length === 0) return showToast("No valid dialogue lines found.", "error");
      
      const estTime = (segmentsRaw.length / 2) + 3; // Optimized Estimate due to batching
      
      startSimulation(estTime, `Analyzing ${segmentsRaw.length} segments...`);

      try {
          // 3. Generate Audio for each segment (BATCHED)
          const processedSegments: DubSegment[] = [];
          const BATCH_SIZE = 4;
          
          for (let i = 0; i < segmentsRaw.length; i += BATCH_SIZE) {
               if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
               
               const batch = segmentsRaw.slice(i, i + BATCH_SIZE);
               
               // Update Progress UI
               setProcessingStage(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(segmentsRaw.length/BATCH_SIZE)}...`);
               const percent = Math.round(((i) / segmentsRaw.length) * 80);
               setProgress(Math.max(10, percent));

               const batchPromises = batch.map(async (seg) => {
                   const mappedVoiceId = settings.speakerMapping?.[seg.speaker] || getVoiceForCharacter(seg.speaker) || settings.voiceId;
                   let effectiveVoiceName = "Fenrir"; 
                   let effectiveVoiceId = mappedVoiceId;

                   if (settings.engine === 'COQ') {
                       effectiveVoiceName = mappedVoiceId; // ID is Name for Coqui
                   } else if (settings.engine === 'OPENAI') {
                       effectiveVoiceName = mappedVoiceId; // ID is name (alloy, echo)
                   } else if (settings.engine === 'F5') {
                       effectiveVoiceName = mappedVoiceId;
                   } else if (settings.engine === 'LOCAL_WEBGPU') {
                       effectiveVoiceName = mappedVoiceId;
                   } else {
                       const v = VOICES.find(x => x.id === mappedVoiceId) || clonedVoices.find(x => x.id === mappedVoiceId);
                       if (v) effectiveVoiceName = v.geminiVoiceName;
                   }
                   
                   const segSettings = { ...settings, chatterboxId: effectiveVoiceId, voiceId: effectiveVoiceId, emotion: seg.emotion || settings.emotion || 'Neutral' }; 
                   
                   try {
                       const buffer = await generateSpeech(seg.text, effectiveVoiceName, segSettings, 'speech', controller.signal);
                       const blob = audioBufferToWav(buffer);
                       const url = URL.createObjectURL(blob);
                       
                       return {
                           id: Math.random().toString(),
                           startTime: seg.startTime,
                           endTime: seg.startTime + buffer.duration, 
                           speaker: seg.speaker,
                           text: seg.text,
                           translatedText: seg.text,
                           emotion: seg.emotion || 'Neutral',
                           gender: 'Unknown', 
                           age: 'Adult',
                           audioUrl: url
                       } as DubSegment;
                   } catch (e: any) {
                       if (e.name === 'AbortError') throw e;
                       console.warn(`Failed segment for ${seg.speaker}:`, e);
                       return null;
                   }
               });
               
               const batchResults = await Promise.all(batchPromises);
               processedSegments.push(...(batchResults.filter(Boolean) as DubSegment[]));
          }

          if (processedSegments.length === 0) throw new Error("Failed to generate any audio segments.");

          setProgress(90);
          setProcessingStage("Mixing with Smart Vocal Suppression...");
          setTimeLeft(2);

          // 4. Get Background Audio
          let bgBuffer: AudioBuffer;
          if (videoFile) {
               bgBuffer = await isolateBackgroundTrack(videoFile);
          } else {
               const ctx = getAudioContext();
               bgBuffer = ctx.createBuffer(2, 48000 * 60, 48000); 
          }

          // 5. Mix
          const mixedUrl = await mixFinalDub(bgBuffer, processedSegments, settings);
          
          setDubAudioUrl(mixedUrl);
          setVideoVolume(1.0); 
          setDubVolume(1.0);

          showToast("Dubbing Complete! Play video to preview.", "success");
          if (!stats.isPremium) updateStats({ generationsUsed: stats.generationsUsed + processedSegments.length });

      } catch (e: any) {
          if (e.name === 'AbortError') {
              // handled by cancel
          } else {
              showToast(e.message, "error");
          }
      } finally {
          stopSimulation();
          generationAbortController.current = null;
      }
  };

  const toggleDubPlayback = () => {
      const video = videoRef.current;
      const audio = dubAudioRef.current;
      if (!video) return;

      if (isPlayingDub) {
          video.pause();
          if (audio) audio.pause();
          setIsPlayingDub(false);
      } else {
          video.play();
          if (audio) audio.play();
          setIsPlayingDub(true);
      }
  };

  // --- AI Tools (Shared) ---

  // --- PROOFREADER ---
  const handleProofread = async (mode: 'grammar' | 'flow' | 'creative' | 'novel' = 'flow') => {
      const currentText = activeTab === Tab.DUBBING ? dubScript : text;
      const setFn = activeTab === Tab.DUBBING ? setDubScript : setText;
      
      if (!currentText || !currentText.trim()) return showToast("Enter text to proofread", "info");
      
      setIsAiWriting(true);
      showToast(mode === 'grammar' ? "Fixing Grammar..." : mode === 'novel' ? "Directing Audio Novel..." : "Optimizing...", "info");
      
      try {
          const polished = await proofreadScript(currentText, settings, mode);
          setFn(polished);
          showToast("Script Enhanced", "success");
      } catch (e: any) {
          showToast(e.message, "error");
      } finally {
          setIsAiWriting(false);
      }
  };

  // --- NOVEL ADAPTER LOGIC ---
  const handleAdaptNovel = async () => {
    if (!novelInput.trim()) return showToast("Please enter a story to adapt.", "info");
    if (!novelTargetCulture.trim() && novelAdaptationMode === 'adapt') return showToast("Please specify a target culture (e.g. 'Mumbai, India')", "info");

    setIsAdaptingNovel(true);
    setNovelOutput('');

    try {
        const result = await localizeNovel(
            novelInput, 
            novelTargetLang, 
            novelTargetCulture, 
            novelAdaptationMode, 
            settings
        );
        setNovelOutput(result);
        showToast("Adaptation Complete!", "success");
    } catch (e: any) {
        showToast(e.message, "error");
    } finally {
        setIsAdaptingNovel(false);
    }
  };

  const sendNovelToStudio = () => {
      if (!novelOutput.trim()) return;
      setText(novelOutput);
      setActiveTab(Tab.STUDIO);
      showToast("Sent to Studio for Audio Generation", "success");
  };

  // --- NEW: MAGIC SCRIPT (Multi-Speaker) ---
  const handleSmartPrep = async () => {
      if (!text.trim()) return showToast("Enter text first", "info");
      setIsAiWriting(true);
      try {
          // 1. Grammar Fix
          showToast("Fixing Grammar...", "info");
          const corrected = await autoCorrectText(text, settings);
          
          // 2. Director & Cast
          showToast("Directing & Casting...", "info");
          const { formattedText, cast, mood } = await autoFormatScript(corrected, settings, 'audio_drama', undefined, characterLibrary);
          
          setText(formattedText);
          
          if (cast && cast.length > 0) {
              syncCast(cast as any);
              
              // Immediate UI Update for Mapping
              setSettings(prev => {
                  const newMapping = { ...prev.speakerMapping };
                  cast.forEach(c => {
                      if (!newMapping[c.name]) {
                          const existingChar = characterLibrary.find(x => x.name.toLowerCase() === c.name.toLowerCase());
                          if (existingChar) newMapping[c.name] = existingChar.voiceId;
                      }
                  });
                  return { ...prev, speakerMapping: newMapping };
              });

              showToast(`Script Ready! ${cast.length} characters cast.`, "success");
          } else {
              showToast(`Script Formatted. Mood: ${mood || 'Neutral'}`, "success");
          }
      } catch (e: any) {
          showToast(e.message, "error");
      } finally {
          setIsAiWriting(false);
      }
  };

  const handleDirectorAI = async (targetText: string, setFn: (s: string) => void, mode: 'audio_drama' | 'video_dub' = 'audio_drama') => {
      if (!targetText) return;
      setIsAiWriting(true);
      try {
          const options = mode === 'video_dub' ? directorOptions : undefined;
          // PASS CHARACTER LIBRARY TO DIRECTOR
          const { formattedText, mood, cast } = await autoFormatScript(targetText, settings, mode, options, characterLibrary);
          setFn(formattedText);
          
          // INTELLIGENT SYNC: Add detected characters with their gender info to library
          if (cast && cast.length > 0) {
              syncCast(cast as any); // Cast has extra metadata now
              showToast(`Script Directed. ${cast.length} characters detected.`, "success");
          } else {
              showToast(`Script Directed. Mood: ${mood || 'Neutral'}`, "success");
          }

      } catch (e: any) {
          showToast(e.message, "error");
      } finally {
          setIsAiWriting(false);
      }
  };
  
  const handleAutoFix = async () => {
      if (!text.trim()) return;
      setIsAiWriting(true);
      try {
          const fixed = await autoCorrectText(text, settings);
          setText(fixed);
          showToast("Text polished!", "success");
      } catch (e: any) {
          showToast(e.message, "error");
      } finally {
          setIsAiWriting(false);
      }
  };

  const handleTranslate = async () => {
      const isDubbing = activeTab === Tab.DUBBING;
      const currentText = isDubbing ? dubScript : text;
      const setFn = isDubbing ? setDubScript : setText;
      
      if(!currentText) return showToast("Enter text first", "info");
      
      setIsAiWriting(true);
      try {
          const translated = await translateText(currentText, targetLang, settings);
          setFn(translated);
          showToast("Translation Complete", "success");
      } catch(e: any) {
          showToast(e.message, "error");
      } finally {
          setIsAiWriting(false);
      }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!chatInput.trim()) return;
      
      const userText = chatInput;
      setChatHistory(prev => [...prev, { role: 'user', text: userText }]);
      setChatInput('');
      setIsChatLoading(true);
      
      const context = activeTab === Tab.DUBBING ? dubScript : text;
      
      try {
          const response = await generateTextContent(userText, context, settings);
          setChatHistory(prev => [...prev, { role: 'ai', text: response }]);
      } catch (e) {
          setChatHistory(prev => [...prev, { role: 'ai', text: "Sorry, I couldn't process that." }]);
      } finally {
          setIsChatLoading(false);
      }
  };

  const handleVoiceClone = async () => {
      if (!cloneName || (cloneMode === 'upload' && !uploadVoiceFile)) return showToast("Missing name or file", "info");
      const file = uploadVoiceFile; 
      if(!file) return;

      startSimulation(5, "Analyzing Voice Print...");

      try {
          const description = await analyzeVoiceSample(file, settings);
          
          // Fake delay to show the cool animation
          await new Promise(r => setTimeout(r, 2000));

          const newVoice: ClonedVoice = {
              id: `clone_${Date.now()}`,
              name: cloneName,
              gender: 'Unknown',
              accent: 'Custom',
              geminiVoiceName: 'Fenrir', 
              originalSampleUrl: URL.createObjectURL(file),
              dateCreated: Date.now(),
              description,
              isCloned: true
          };
          addClonedVoice(newVoice);
          setSettings(s => ({ ...s, voiceId: newVoice.id }));
          showToast("Voice Cloned Successfully!", "success");
          setCloneName('');
          setUploadVoiceFile(null);
      } catch(e: any) {
          showToast(e.message, "error");
      } finally {
          stopSimulation();
      }
  };

  // --- Derived State for Gallery ---
  const filteredVoices = VOICES.filter(v => {
      const matchesSearch = v.name.toLowerCase().includes(voiceSearch.toLowerCase()) || v.accent.toLowerCase().includes(voiceSearch.toLowerCase());
      const matchesGender = voiceFilterGender === 'All' || v.gender === voiceFilterGender;
      const matchesAccent = voiceFilterAccent === 'All' || v.accent === voiceFilterAccent;
      return matchesSearch && matchesGender && matchesAccent;
  });

  const uniqueAccents = Array.from(new Set(VOICES.map(v => v.accent))).sort();

  // --- UI Components ---

  const Sidebar = () => (
    <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-100 transform transition-transform duration-300 md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 flex items-center gap-3 border-b border-gray-50">
            {/* Premium Logo Design */}
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 flex items-center justify-center shadow-lg shadow-indigo-200 text-white relative overflow-hidden">
                <div className="absolute inset-0 bg-white/20 rounded-full blur-md transform -translate-x-2 -translate-y-2"></div>
                <Bot size={20} strokeWidth={2.5} />
            </div>
            <div>
                <h1 className="font-bold text-xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600">VoiceFlow</h1>
                <p className="text-[10px] text-gray-400 font-mono font-bold uppercase tracking-widest">AI Studio</p>
            </div>
        </div>

        <nav className="p-4 space-y-1">
            {[
                { id: Tab.STUDIO, icon: <Mic size={18} />, label: 'Studio' },
                { id: Tab.NOVEL, icon: <BookOpen size={18} />, label: 'Novel Adapter' },
                { id: Tab.DUBBING, icon: <Film size={18} />, label: 'Video Dub' },
                { id: Tab.CHARACTERS, icon: <Users size={18} />, label: 'Characters' },
                { id: Tab.LAB, icon: <Fingerprint size={18} />, label: 'Voice Lab' },
            ].map(item => (
                <button 
                    key={item.id}
                    onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === item.id ? 'bg-indigo-50 text-indigo-600 shadow-sm ring-1 ring-indigo-100' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
                >
                    {item.icon} {item.label}
                </button>
            ))}
        </nav>

        {activeTab === Tab.STUDIO && (
            <div className="mt-6 px-6 animate-in fade-in">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center justify-between">
                    <span>Recent Drafts</span>
                    <button onClick={() => { setText(''); setSettings(s => ({...s, speakerMapping: {}})) }} className="text-indigo-600 hover:underline">New</button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                    {drafts.length === 0 && <div className="text-xs text-gray-400 italic">No drafts yet</div>}
                    {drafts.map(d => (
                        <div key={d.id} onClick={() => { setText(d.text); setSettings(d.settings); setIsMobileMenuOpen(false); }} className="group flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                            <div className="flex items-center gap-2 overflow-hidden">
                                <FileText size={14} className="text-gray-400 flex-shrink-0"/>
                                <span className="text-sm text-gray-600 truncate">{d.name}</span>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); deleteDraft(d.id); }} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600"><X size={12}/></button>
                        </div>
                    ))}
                </div>
            </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-white transition-colors cursor-pointer" onClick={() => setScreen(AppScreen.PROFILE)}>
                <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold shadow-sm border border-white">
                    {user.avatarUrl ? <img src={user.avatarUrl} className="w-full h-full rounded-full object-cover"/> : user.name[0]}
                </div>
                <div className="flex-1 overflow-hidden">
                    <div className="text-sm font-bold text-gray-900 truncate">{user.name}</div>
                    <div className="text-[10px] text-gray-500 truncate">{user.email}</div>
                </div>
                <Settings size={16} className="text-gray-400" />
            </div>
        </div>
    </aside>
  );

  const SettingsPanel = () => (
      <div className={`fixed inset-y-0 right-0 z-50 w-96 bg-white shadow-2xl transform transition-transform duration-300 ${showSettings ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="h-full flex flex-col">
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white z-10">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Settings size={18} className="text-indigo-600"/> Configuration</h2>
                  <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-gray-100 rounded-full"><X size={18}/></button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-gray-50/50">
                  {/* Engine Selection */}
                  <section>
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 block">Audio Engine</label>
                      <div className="grid grid-cols-1 gap-2 mb-2">
                          <div onClick={() => setSettings(s => ({...s, engine: 'GEM', voiceId: 'v1'}))} className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-3 ${settings.engine === 'GEM' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white hover:border-indigo-200'}`}>
                              <Sparkles size={20} className={`shrink-0 ${settings.engine === 'GEM' ? 'text-indigo-600' : 'text-gray-400'}`} />
                              <div>
                                  <div className="font-bold text-sm">Gemini Cloud</div>
                                  <div className="text-[10px] text-gray-500">Google AI Studio (Default)</div>
                              </div>
                          </div>
                          
                          <div onClick={() => setSettings(s => ({...s, engine: 'OPENAI', voiceId: 'alloy'}))} className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-3 ${settings.engine === 'OPENAI' ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white hover:border-green-200'}`}>
                              <Terminal size={20} className={`shrink-0 ${settings.engine === 'OPENAI' ? 'text-green-600' : 'text-gray-400'}`} />
                              <div>
                                  <div className="font-bold text-sm">OpenAI / Compatible</div>
                                  <div className="text-[10px] text-gray-500">Standard Models</div>
                              </div>
                          </div>

                          <div onClick={() => setSettings(s => ({...s, engine: 'F5', voiceId: 'f5_basic_m'}))} className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-3 ${settings.engine === 'F5' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 bg-white hover:border-amber-200'}`}>
                              <Zap size={20} className={`shrink-0 ${settings.engine === 'F5' ? 'text-amber-600' : 'text-gray-400'}`} />
                              <div>
                                  <div className="font-bold text-sm">F5-TTS (Backend)</div>
                                  <div className="text-[10px] text-gray-500">Optimized for Cloning</div>
                              </div>
                          </div>
                          
                          <div onClick={() => setSettings(s => ({...s, engine: 'LOCAL_WEBGPU'}))} className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-3 ${settings.engine === 'LOCAL_WEBGPU' ? 'border-violet-500 bg-violet-50' : 'border-gray-200 bg-white hover:border-violet-200'}`}>
                              <Laptop size={20} className={`shrink-0 ${settings.engine === 'LOCAL_WEBGPU' ? 'text-violet-600' : 'text-gray-400'}`} />
                              <div>
                                  <div className="font-bold text-sm">On-Device (WebGPU)</div>
                                  <div className="text-[10px] text-gray-500">F5 / Transformers.js (Inbuilt)</div>
                              </div>
                          </div>

                          <div onClick={() => setSettings(s => ({...s, engine: 'COQ'}))} className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-3 ${settings.engine === 'COQ' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-200'}`}>
                              <Server size={20} className={`shrink-0 ${settings.engine === 'COQ' ? 'text-blue-600' : 'text-gray-400'}`} />
                              <div>
                                  <div className="font-bold text-sm">Coqui TTS</div>
                                  <div className="text-[10px] text-gray-500">Legacy Server</div>
                              </div>
                          </div>
                      </div>

                      {settings.engine === 'LOCAL_WEBGPU' && (
                           <div className="mt-4 animate-in fade-in p-4 bg-violet-50/50 rounded-xl border border-violet-100">
                              <div className="flex items-center justify-between mb-3">
                                <label className="text-xs font-bold text-violet-800">Inbuilt Configuration</label>
                                <span className="text-[10px] px-2 py-1 bg-violet-200 text-violet-800 rounded-full font-bold">Experimental</span>
                              </div>
                              <p className="text-[10px] text-gray-500 mb-2">
                                  Runs standard Transformers models (like SpeechT5/F5 equivalents) directly in your browser using WebGPU. No backend required.
                              </p>
                              <div className="flex items-center gap-2 text-xs text-violet-700 bg-white p-2 rounded border border-violet-100">
                                  <Cpu size={14}/> <span>GPU Acceleration Active</span>
                              </div>
                           </div>
                      )}

                      {settings.engine === 'F5' && (
                          <div className="mt-4 animate-in fade-in p-4 bg-amber-50/50 rounded-xl border border-amber-100">
                              <div className="flex items-center justify-between mb-3">
                                <label className="text-xs font-bold text-amber-800">F5 Configuration</label>
                                <span className="text-[10px] px-2 py-1 bg-amber-200 text-amber-800 rounded-full font-bold">Zero-Shot</span>
                              </div>
                              
                              <label className="text-[10px] font-bold text-gray-500 uppercase mb-1">Backend URL</label>
                              <div className="flex gap-2 mb-3">
                                  <input 
                                    type="text" 
                                    placeholder="https://...ngrok-free.app" 
                                    className="flex-1 p-2.5 text-xs border border-gray-300 rounded-lg focus:border-amber-500 outline-none font-mono"
                                    value={settings.backendUrl}
                                    onChange={(e) => setSettings(s => ({...s, backendUrl: e.target.value}))}
                                  />
                                  <button onClick={checkBackendConnection} className="p-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700">
                                      <CheckCircle2 size={14}/>
                                  </button>
                              </div>

                              <div className="grid grid-cols-2 gap-2 mb-3">
                                 <div>
                                     <label className="text-[10px] font-bold text-gray-500 uppercase mb-1">Model ID</label>
                                     <input 
                                        type="text" 
                                        value={settings.f5Model || 'f5-tts'}
                                        onChange={(e) => setSettings(s => ({...s, f5Model: e.target.value}))}
                                        className="w-full p-2 text-xs border border-gray-300 rounded-lg"
                                     />
                                 </div>
                                 <div>
                                     <label className="text-[10px] font-bold text-gray-500 uppercase mb-1">Speed</label>
                                     <input 
                                        type="number" 
                                        step="0.1"
                                        min="0.5"
                                        max="2.0"
                                        value={settings.speed || 1.0}
                                        onChange={(e) => setSettings(s => ({...s, speed: parseFloat(e.target.value)}))}
                                        className="w-full p-2 text-xs border border-gray-300 rounded-lg"
                                     />
                                 </div>
                              </div>

                              <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-amber-200/50">
                                  <span className="text-xs font-medium text-gray-700 flex items-center gap-2">
                                      <Cpu size={12} className="text-amber-600"/> Client Optimization
                                  </span>
                                  <div 
                                      onClick={() => setSettings(s => ({...s, enableWebGpu: !s.enableWebGpu}))}
                                      className={`w-10 h-5 rounded-full relative cursor-pointer transition-colors ${settings.enableWebGpu ? 'bg-amber-500' : 'bg-gray-300'}`}
                                  >
                                      <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-transform ${settings.enableWebGpu ? 'left-6' : 'left-1'}`}></div>
                                  </div>
                              </div>
                              <p className="text-[9px] text-gray-400 mt-2">
                                  Enables raw PCM streaming and faster decoding.
                              </p>
                          </div>
                      )}

                      {settings.engine === 'OPENAI' && (
                          <div className="mt-4 animate-in fade-in p-4 bg-green-50/50 rounded-xl border border-green-100">
                              <label className="text-xs font-bold text-gray-700 mb-1.5 block">Endpoint URL</label>
                              <div className="flex gap-2 mb-3">
                                  <input 
                                    type="text" 
                                    placeholder="https://...ngrok-free.app" 
                                    className="flex-1 p-2.5 text-xs border border-gray-300 rounded-lg focus:border-green-500 outline-none font-mono"
                                    value={settings.backendUrl}
                                    onChange={(e) => setSettings(s => ({...s, backendUrl: e.target.value}))}
                                  />
                                  <button onClick={checkBackendConnection} className="p-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700">
                                      <CheckCircle2 size={14}/>
                                  </button>
                              </div>
                              <label className="text-xs font-bold text-gray-700 mb-1.5 block">Model Name</label>
                              <input 
                                    type="text" 
                                    placeholder="tts-1 or openedai-speech..." 
                                    className="w-full p-2.5 text-xs border border-gray-300 rounded-lg focus:border-green-500 outline-none font-mono"
                                    value={settings.openaiModel || 'openedai-speech-bilingual-tts-1'}
                                    onChange={(e) => setSettings(s => ({...s, openaiModel: e.target.value}))}
                              />
                          </div>
                      )}
                  </section>

                  {/* AI Helper */}
                  <section>
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 block">AI Assistant Provider</label>
                      <div className="bg-white p-1 rounded-xl border border-gray-200 flex mb-3">
                          {['GEMINI', 'PERPLEXITY', 'LOCAL'].map((p: any) => (
                              <button 
                                key={p}
                                onClick={() => setSettings(s => ({...s, helperProvider: p}))}
                                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${settings.helperProvider === p ? 'bg-gray-100 text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                              >
                                {p}
                              </button>
                          ))}
                      </div>
                      
                      <div className="space-y-3 animate-in fade-in bg-white p-3 rounded-xl border border-gray-100">
                          {settings.helperProvider === 'PERPLEXITY' && (
                              <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 flex items-center gap-1"><Lock size={10}/> Perplexity API Key</label>
                                  <input 
                                      type="password"
                                      value={settings.perplexityApiKey || ''}
                                      onChange={(e) => setSettings(s => ({...s, perplexityApiKey: e.target.value}))}
                                      placeholder="pplx-..."
                                      className="w-full p-2.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-indigo-500 font-mono bg-gray-50 focus:bg-white transition-colors"
                                  />
                                  <p className="text-[10px] text-gray-400 mt-1">Required for advanced web-search translation.</p>
                              </div>
                          )}
                          
                          {settings.helperProvider === 'LOCAL' && (
                              <div>
                                  <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 flex items-center gap-1"><Terminal size={10}/> Local LLM URL</label>
                                  <input 
                                      type="text"
                                      value={settings.localLlmUrl || ''}
                                      onChange={(e) => setSettings(s => ({...s, localLlmUrl: e.target.value}))}
                                      placeholder="http://localhost:1234/v1"
                                      className="w-full p-2.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-indigo-500 font-mono bg-gray-50 focus:bg-white transition-colors"
                                  />
                                  <p className="text-[10px] text-gray-400 mt-1">Compatible with LM Studio, Ollama, etc.</p>
                              </div>
                          )}
                      </div>
                  </section>

                   {/* Audio Settings */}
                   <section>
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 block">Audio Mix</label>
                      <div className="space-y-4 bg-white p-4 rounded-xl border border-gray-200">
                          <div>
                              <div className="flex justify-between text-xs mb-1 font-bold text-gray-700"><span>Speech Speed</span> <span>{settings.speed}x</span></div>
                              <input type="range" min="0.5" max="2.0" step="0.1" value={settings.speed} onChange={(e) => setSettings(s => ({...s, speed: parseFloat(e.target.value)}))} className="w-full accent-indigo-600 h-1.5 bg-gray-100 rounded-lg appearance-none"/>
                          </div>
                          {activeTab === Tab.STUDIO && (
                              <div>
                                  <div className="flex justify-between text-xs mb-1 font-bold text-gray-700"><span>Backing Music</span></div>
                                  <select 
                                    value={settings.musicTrackId} 
                                    onChange={(e) => setSettings(s => ({...s, musicTrackId: e.target.value}))}
                                    className="w-full p-2 text-xs border border-gray-200 rounded-lg outline-none bg-gray-50"
                                  >
                                      {MUSIC_TRACKS.map(t => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
                                  </select>
                              </div>
                          )}
                          <div>
                              <div className="flex justify-between text-xs mb-1 font-bold text-gray-700"><span>TTS Output Language</span></div>
                              <select 
                                value={settings.language} 
                                onChange={(e) => setSettings(s => ({...s, language: e.target.value}))}
                                className="w-full p-2 text-xs border border-gray-200 rounded-lg outline-none bg-gray-50"
                              >
                                  <option value="Auto">Auto-Detect</option>
                                  {LANGUAGES.map(l => <option key={l.code} value={l.name}>{l.name}</option>)}
                              </select>
                          </div>
                      </div>
                   </section>
              </div>

              <div className="p-4 border-t border-gray-100 bg-white">
                  <Button fullWidth onClick={() => setShowSettings(false)}>Save Changes</Button>
              </div>
          </div>
      </div>
  );

  return (
    <div className="flex min-h-screen bg-[#f8fafc] font-sans text-gray-900">
      {/* Mobile Overlay */}
      {isMobileMenuOpen && <div className="fixed inset-0 bg-black/20 z-30 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />}
      
      {/* Sidebar Navigation */}
      <Sidebar />
      
      {/* Main Content */}
      <main className="flex-1 flex flex-col md:pl-64 relative h-screen overflow-hidden transition-all">
        
        {/* Top Bar */}
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-gray-200 flex items-center justify-between px-6 z-20 sticky top-0">
             <div className="flex items-center gap-4">
                 <button className="md:hidden p-2 -ml-2 text-gray-600" onClick={() => setIsMobileMenuOpen(true)}><Menu /></button>
                 <h1 className="font-bold text-lg text-gray-800 hidden sm:block">
                    {activeTab === Tab.STUDIO ? 'Audio Studio' : activeTab === Tab.DUBBING ? 'Video Dubbing Studio' : activeTab === Tab.CHARACTERS ? 'Character Library' : activeTab === Tab.NOVEL ? 'Novel Adapter' : 'Voice Lab'}
                 </h1>
             </div>

             <div className="flex items-center gap-3">
                 {/* Usage Badge */}
                 <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-full text-xs font-bold text-gray-600 border border-gray-200">
                     <Box size={14} />
                     {stats.isPremium ? 'PRO UNLIMITED' : `${stats.generationsUsed} / ${stats.generationsLimit} Gens`}
                 </div>
                 
                 {!stats.isPremium && (
                     <button onClick={() => setShowSubscriptionModal(true)} className="px-3 py-1.5 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-xs font-bold rounded-full shadow-md shadow-orange-200 hover:scale-105 transition-transform">
                         Upgrade
                     </button>
                 )}
                 
                 <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors relative">
                     <Settings size={20} />
                     {settings.engine === 'COQ' && (
                         <span className={`absolute top-2 right-2 w-2 h-2 rounded-full ${coquiSpeakers.length > 0 ? 'bg-green-500' : 'bg-red-500'} border border-white`}></span>
                     )}
                     {(settings.engine === 'OPENAI' || settings.engine === 'F5') && (
                         <span className={`absolute top-2 right-2 w-2 h-2 rounded-full ${settings.backendUrl ? 'bg-green-500' : 'bg-yellow-500'} border border-white`}></span>
                     )}
                     {settings.engine === 'LOCAL_WEBGPU' && (
                         <span className={`absolute top-2 right-2 w-2 h-2 rounded-full bg-violet-500 border border-white`}></span>
                     )}
                 </button>
             </div>
        </header>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-8 pb-32 relative">
            <div className="max-w-5xl mx-auto space-y-6">
                
                {activeTab === Tab.STUDIO && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Editor Section */}
                        <div className="lg:col-span-2 space-y-4">
                            {/* Reduced Height Editor */}
                            <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-[300px] relative group transition-all hover:shadow-md">
                                {/* Toolbar */}
                                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => setText(t => t + ' [pause] ')} className="p-1.5 text-xs font-bold text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg flex items-center gap-1 transition-colors" title="Insert Pause"><Clock size={14}/> <span className="hidden sm:inline">Pause</span></button>
                                        <button onClick={() => setText(t => t + ' (Whisper): ')} className="p-1.5 text-xs font-bold text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg flex items-center gap-1 transition-colors" title="Whisper"><Volume2 size={14}/> <span className="hidden sm:inline">Whisper</span></button>
                                        
                                        <div className="w-px h-4 bg-gray-300 mx-1 opacity-50"></div>
                                        
                                        <div className="flex items-center gap-0.5 bg-teal-50 rounded-lg border border-teal-100 p-0.5">
                                            <button 
                                                onClick={() => handleProofread('grammar')} 
                                                disabled={isAiWriting} 
                                                className="p-1.5 text-xs font-bold text-teal-700 hover:bg-white hover:shadow-sm rounded-md transition-all flex items-center gap-1" 
                                                title="Strict Grammar Check"
                                            >
                                                <SpellCheck size={14}/>
                                            </button>
                                            <div className="w-px h-3 bg-teal-200"></div>
                                            <button 
                                                onClick={() => handleProofread('flow')} 
                                                disabled={isAiWriting} 
                                                className="p-1.5 text-xs font-bold text-teal-700 hover:bg-white hover:shadow-sm rounded-md transition-all flex items-center gap-1" 
                                                title="Optimize Flow & Naturalness"
                                            >
                                                <BookOpenCheck size={14}/> <span className="hidden sm:inline">Flow</span>
                                            </button>
                                            <div className="w-px h-3 bg-teal-200"></div>
                                            <button 
                                                onClick={() => handleProofread('novel')} 
                                                disabled={isAiWriting} 
                                                className="p-1.5 text-xs font-bold text-teal-700 hover:bg-white hover:shadow-sm rounded-md transition-all flex items-center gap-1" 
                                                title="Enhance for Audio Novel (Advanced)"
                                            >
                                                <Book size={14}/> <span className="hidden sm:inline">Audio Novel</span>
                                            </button>
                                        </div>
                                        
                                        {/* MAGIC SCRIPT BUTTON */}
                                        <button onClick={handleSmartPrep} disabled={isAiWriting} className="ml-1 p-1.5 text-xs font-bold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 rounded-lg flex items-center gap-1 transition-all shadow-sm" title="Auto Grammar + Format + Cast">
                                            <Sparkles size={14} fill="currentColor" className="text-yellow-200"/> <span className="hidden sm:inline">Magic Script</span>
                                        </button>
                                        
                                        <div className="w-px h-4 bg-gray-300 mx-1 opacity-50"></div>

                                        <button onClick={() => { setText(''); setGeneratedAudioUrl(null); }} className="p-1.5 text-xs font-bold text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Clear"><Trash2 size={14}/></button>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 shrink-0">
                                         {detectedLang && <span className="text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200 px-2 py-1 rounded-md uppercase">{detectedLang}</span>}
                                         <button onClick={() => handleDirectorAI(text, setText, 'audio_drama')} disabled={isAiWriting} className="text-xs font-bold bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-indigo-200 disabled:opacity-50 transition-colors shadow-sm shadow-indigo-200/50">
                                            {isAiWriting ? <Loader2 size={13} className="animate-spin"/> : <Wand2 size={13}/>} 
                                            <span>AI Director</span>
                                         </button>
                                    </div>
                                </div>
                                
                                <textarea 
                                    ref={textareaRef}
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    placeholder="Write your script here... The AI Director can auto-assign voices for characters."
                                    className="flex-1 p-6 resize-none outline-none text-lg text-gray-700 leading-relaxed font-serif placeholder:text-gray-300 bg-transparent custom-scrollbar"
                                />

                                {/* Translation Bar - Hinglish Focus */}
                                <div className="px-4 py-2 bg-gradient-to-r from-indigo-50/80 to-purple-50/80 backdrop-blur-sm border-t border-gray-100 flex items-center justify-between gap-2 relative z-10">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <Languages size={14} className="text-indigo-600 shrink-0"/>
                                        <span className="text-xs font-bold text-gray-600 hidden sm:inline">Translate:</span>
                                        <div className="flex items-center gap-1 bg-white rounded-lg border border-indigo-100 p-0.5 shadow-sm overflow-x-auto no-scrollbar">
                                            <button 
                                                onClick={() => setTargetLang('Hinglish')} 
                                                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all flex items-center gap-1 whitespace-nowrap ${targetLang === 'Hinglish' ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white shadow-md shadow-orange-200' : 'text-gray-600 hover:bg-gray-100'}`}
                                            >
                                                <span className="text-xs">🇮🇳</span> Hinglish
                                            </button>
                                            <button 
                                                onClick={() => setTargetLang('English')} 
                                                className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap ${targetLang === 'English' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
                                            >
                                                English
                                            </button>
                                             <button 
                                                onClick={() => setTargetLang('Hindi')} 
                                                className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap ${targetLang === 'Hindi' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
                                            >
                                                Hindi
                                            </button>
                                            <select 
                                                value={targetLang}
                                                onChange={(e) => setTargetLang(e.target.value)}
                                                className="px-2 py-1 text-[10px] font-bold bg-transparent outline-none text-gray-500 hover:text-gray-800 cursor-pointer max-w-[80px]"
                                            >
                                                <option value="">More...</option>
                                                {LANGUAGES.filter(l => !['Hinglish', 'English', 'Hindi'].includes(l.name)).map(l => (
                                                    <option key={l.code} value={l.name}>{l.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={handleTranslate}
                                        disabled={isAiWriting}
                                        className="text-xs font-bold text-indigo-600 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap"
                                    >
                                        {isAiWriting ? <Loader2 size={12} className="animate-spin"/> : <Globe size={12}/>} Run Translate
                                    </button>
                                </div>

                                <div className="px-6 py-3 border-t border-gray-50 text-xs text-gray-400 flex justify-between bg-white">
                                    <span>{text.length} chars</span>
                                    <div className="flex items-center gap-2">
                                         <button onClick={() => saveDraft(`Draft ${new Date().toLocaleTimeString()}`, text, settings)} className="hover:text-indigo-600 flex items-center gap-1"><Save size={12}/> Save Draft</button>
                                    </div>
                                </div>
                            </div>

                            {/* Generated Audio Player */}
                            {generatedAudioUrl && (
                                <div className="animate-in slide-in-from-bottom-4">
                                    <AudioPlayer audioUrl={generatedAudioUrl} onReset={() => setGeneratedAudioUrl(null)} />
                                </div>
                            )}
                        </div>

                        {/* Controls Sidebar */}
                        <div className="space-y-6">
                            
                            {/* Backend Connection Card (F5/OPENAI) */}
                            {(settings.engine === 'OPENAI' || settings.engine === 'F5') && (
                                <div className={`bg-white p-4 rounded-3xl shadow-sm border animate-in fade-in ${settings.engine === 'F5' ? 'border-amber-200' : 'border-gray-200'}`}>
                                    <div className="flex items-center justify-between mb-3">
                                         <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 ${settings.engine === 'F5' ? 'text-amber-600' : 'text-green-600'}`}>
                                            {settings.engine === 'F5' ? <Zap size={12}/> : <Terminal size={12}/>} {settings.engine === 'F5' ? 'F5-TTS Backend' : 'Local Engine'}
                                         </h3>
                                    </div>
                                    <div className="space-y-2">
                                        <input 
                                            type="text" 
                                            value={settings.backendUrl}
                                            onChange={(e) => setSettings(s => ({...s, backendUrl: e.target.value}))}
                                            placeholder="Ngrok URL..." 
                                            className={`w-full bg-gray-50 border rounded-xl px-3 py-2 text-xs font-mono focus:ring-2 outline-none ${settings.engine === 'F5' ? 'border-amber-100 focus:ring-amber-500' : 'border-gray-200 focus:ring-green-500'}`}
                                        />
                                        <input 
                                            type="text" 
                                            value={settings.engine === 'F5' ? (settings.f5Model || 'f5-tts') : (settings.openaiModel || 'openedai-speech-bilingual-tts-1')}
                                            onChange={(e) => setSettings(s => settings.engine === 'F5' ? ({...s, f5Model: e.target.value}) : ({...s, openaiModel: e.target.value}))}
                                            placeholder="Model Name" 
                                            className={`w-full bg-gray-50 border rounded-xl px-3 py-2 text-xs font-mono focus:ring-2 outline-none ${settings.engine === 'F5' ? 'border-amber-100 focus:ring-amber-500' : 'border-gray-200 focus:ring-green-500'}`}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Voice Selector Card */}
                            <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-200">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Speaker</h3>
                                    <span className={`text-xs font-bold ${settings.engine === 'OPENAI' ? 'text-green-600' : settings.engine === 'COQ' ? 'text-blue-600' : settings.engine === 'F5' ? 'text-amber-600' : settings.engine === 'LOCAL_WEBGPU' ? 'text-violet-600' : 'text-indigo-600'}`}>
                                        {settings.engine === 'COQ' ? 'Coqui' : settings.engine === 'OPENAI' ? 'OpenAI' : settings.engine === 'F5' ? 'F5-TTS' : settings.engine === 'LOCAL_WEBGPU' ? 'WebGPU' : 'Gemini'}
                                    </span>
                                </div>
                                
                                <div className="flex flex-wrap gap-2 max-h-60 overflow-y-auto custom-scrollbar mb-4">
                                    {(settings.engine === 'COQ' ? coquiSpeakers : settings.engine === 'OPENAI' ? OPENAI_VOICES : settings.engine === 'F5' ? F5_VOICES : VOICES).map((v: any) => {
                                        const isSelected = (settings.engine === 'COQ' || settings.engine === 'OPENAI' || settings.engine === 'F5' || settings.engine === 'LOCAL_WEBGPU') ? (settings.chatterboxId === v.id || settings.voiceId === v.id) : settings.voiceId === v.id;
                                        return (
                                            <button
                                                key={v.id}
                                                onClick={() => {
                                                    if (settings.engine === 'COQ') setSettings(s => ({...s, chatterboxId: v.id, voiceId: v.id}));
                                                    else if (settings.engine === 'OPENAI' || settings.engine === 'F5' || settings.engine === 'LOCAL_WEBGPU') setSettings(s => ({...s, voiceId: v.id, chatterboxId: v.id}));
                                                    else setSettings(s => ({...s, voiceId: v.id}));
                                                }}
                                                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200' : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100'}`}
                                            >
                                                <div className={`w-5 h-5 rounded-full flex items-center justify-center ${isSelected ? 'bg-white/20' : 'bg-gray-200'}`}>{v.name[0]}</div>
                                                {v.name}
                                            </button>
                                        )
                                    })}
                                    {/* Add Clones */}
                                    {(settings.engine === 'GEM' || settings.engine === 'F5') && clonedVoices.map(v => (
                                        <button
                                            key={v.id}
                                            onClick={() => setSettings(s => ({...s, voiceId: v.id}))}
                                            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${settings.voiceId === v.id ? 'bg-amber-50 text-white border-amber-500' : 'bg-amber-50 text-amber-700 border-amber-100'}`}
                                        >
                                             <Fingerprint size={14}/> {v.name}
                                        </button>
                                    ))}
                                </div>
                                
                                {/* Emotion/Speed Selector */}
                                <div className="pt-4 border-t border-gray-100 space-y-3">
                                    {settings.engine === 'GEM' && (
                                        <div>
                                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Emotion</h3>
                                            <select 
                                                value={settings.emotion} 
                                                onChange={(e) => setSettings(s => ({...s, emotion: e.target.value}))}
                                                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                {EMOTIONS.map(e => <option key={e} value={e}>{e}</option>)}
                                            </select>
                                        </div>
                                    )}
                                    {(settings.engine === 'F5' || settings.engine === 'OPENAI') && (
                                        <div>
                                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex justify-between">
                                                <span>Speed</span> <span>{settings.speed}x</span>
                                            </h3>
                                            <input type="range" min="0.5" max="2.0" step="0.1" value={settings.speed} onChange={(e) => setSettings(s => ({...s, speed: parseFloat(e.target.value)}))} className="w-full accent-indigo-600 h-1.5 bg-gray-100 rounded-lg appearance-none"/>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Detected Cast (Multi-Speaker) */}
                            {detectedSpeakers.length > 0 && (
                                <div className="bg-indigo-50 p-5 rounded-3xl border border-indigo-100 animate-in fade-in">
                                    <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-3 flex items-center gap-2"><Bot size={14}/> AI Cast</h3>
                                    <div className="space-y-2">
                                        {detectedSpeakers.map(speaker => (
                                            <div key={speaker} className="flex items-center justify-between bg-white p-2 rounded-lg border border-indigo-100 shadow-sm">
                                                <span className="text-xs font-bold text-gray-700">{speaker}</span>
                                                <select 
                                                    className="text-[10px] font-bold bg-gray-50 rounded p-1 outline-none max-w-[100px]"
                                                    value={settings.speakerMapping?.[speaker] || ''}
                                                    onChange={(e) => {
                                                        const newVoiceId = e.target.value;
                                                        // Update Settings Mapping
                                                        setSettings(s => ({...s, speakerMapping: {...s.speakerMapping, [speaker]: newVoiceId}}));
                                                        
                                                        // Update Character Library (PERSISTENCE)
                                                        const char = characterLibrary.find(c => c.name.toLowerCase() === speaker.toLowerCase());
                                                        if(char) {
                                                            updateCharacter({...char, voiceId: newVoiceId});
                                                        } else {
                                                            // Create new if missing (should be handled by syncCast but just in case)
                                                            let voice;
                                                            if (settings.engine === 'COQ') voice = coquiSpeakers.find(v => v.id === newVoiceId);
                                                            else if (settings.engine === 'OPENAI') voice = OPENAI_VOICES.find(v => v.id === newVoiceId);
                                                            else if (settings.engine === 'F5') voice = F5_VOICES.find(v => v.id === newVoiceId);
                                                            else if (settings.engine === 'LOCAL_WEBGPU') voice = VOICES.find(v => v.id === newVoiceId); // Use Gem voices as placeholder mapping for now
                                                            else voice = VOICES.find(v => v.id === newVoiceId);
                                                            
                                                            voice = voice || VOICES[0];
                                                            
                                                            updateCharacter({
                                                                id: Date.now().toString(),
                                                                name: speaker,
                                                                voiceId: newVoiceId,
                                                                gender: voice.gender || 'Unknown',
                                                                age: 'Adult'
                                                            });
                                                        }
                                                    }}
                                                >
                                                     {(settings.engine === 'COQ' ? coquiSpeakers : settings.engine === 'OPENAI' ? OPENAI_VOICES : settings.engine === 'F5' ? F5_VOICES : VOICES).map((v: any) => (
                                                         <option key={v.id} value={v.id}>{v.name}</option>
                                                     ))}
                                                </select>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-2 text-[10px] text-gray-400 text-center">
                                        Voices are automatically saved to your Character Library.
                                    </div>
                                </div>
                            )}

                            <Button 
                                onClick={handleGenerate} 
                                disabled={isGenerating} 
                                fullWidth 
                                size="lg" 
                                className="bg-gradient-to-r from-indigo-600 to-purple-600 shadow-lg shadow-indigo-300 hover:shadow-indigo-400 hover:scale-[1.02] transition-all"
                            >
                                {isGenerating ? <><Loader2 className="animate-spin mr-2"/> Generating...</> : <><Play size={20} className="mr-2" fill="white"/> Generate Audio</>}
                            </Button>
                        </div>
                    </div>
                )}
                
                {/* --- REDESIGNED CHARACTER TAB --- */}
                {activeTab === Tab.CHARACTERS && (
                    <div className="max-w-5xl mx-auto animate-in fade-in">
                        
                        {/* Tab Switcher & Header */}
                        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-6">
                            <div>
                                <h2 className="text-2xl font-bold text-gray-800">Character & Voice Studio</h2>
                                <p className="text-sm text-gray-500">Manage your cast or browse the gallery to find the perfect voice.</p>
                            </div>
                            
                            <div className="flex bg-white p-1 rounded-xl shadow-sm border border-gray-200">
                                <button 
                                    onClick={() => setCharTab('CAST')}
                                    className={`px-5 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${charTab === 'CAST' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                                >
                                    <Users size={16}/> My Cast
                                </button>
                                <button 
                                    onClick={() => setCharTab('GALLERY')}
                                    className={`px-5 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${charTab === 'GALLERY' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                                >
                                    <StoreIcon size={16}/> Voice Gallery
                                </button>
                            </div>
                        </div>

                        {/* --- MY CAST VIEW --- */}
                        {charTab === 'CAST' && (
                             <>
                                 <div className="flex justify-end mb-4">
                                     <Button onClick={() => openCharacterModal()} className="shadow-lg shadow-indigo-200">
                                         <Plus size={18} className="mr-2"/> Add Character
                                     </Button>
                                 </div>
                                 
                                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                                     {characterLibrary.map(char => {
                                         const voice = VOICES.find(v => v.id === char.voiceId) || clonedVoices.find(v => v.id === char.voiceId) || coquiSpeakers.find(v => v.id === char.voiceId) || OPENAI_VOICES.find(v => v.id === char.voiceId) || F5_VOICES.find(v => v.id === char.voiceId);
                                         const isLoadingPreview = previewState?.id === char.voiceId && previewState.status === 'loading';
                                         const isPlayingPreview = previewState?.id === char.voiceId && previewState.status === 'playing';

                                         return (
                                             <div key={char.id} className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                                                 <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-gray-50 to-transparent rounded-bl-full pointer-events-none"></div>
                                                 
                                                 <div className="flex items-start gap-4 mb-4 relative z-10">
                                                     <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-lg transform group-hover:scale-105 transition-transform" style={{ backgroundColor: char.avatarColor || '#6366f1' }}>
                                                         {char.name.substring(0, 2).toUpperCase()}
                                                     </div>
                                                     <div className="flex-1">
                                                         <h3 className="font-bold text-lg text-gray-900 leading-tight">{char.name}</h3>
                                                         <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-gray-100 text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                                                             {char.age || 'Adult'} • {char.gender || 'Unknown'}
                                                         </span>
                                                     </div>
                                                     
                                                     <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                         <button onClick={() => openCharacterModal(char)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"><Edit2 size={16}/></button>
                                                         <button onClick={() => deleteChar(char.id)} className="p-2 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>
                                                     </div>
                                                 </div>

                                                 <div className="bg-gray-50 rounded-xl p-3 border border-gray-100 flex items-center justify-between">
                                                      <div className="flex flex-col">
                                                          <span className="text-[10px] font-bold text-gray-400 uppercase">Assigned Voice</span>
                                                          <span className="text-sm font-bold text-indigo-600 truncate max-w-[120px]">{voice?.name || char.voiceId}</span>
                                                      </div>
                                                      <button 
                                                          onClick={(e) => { e.stopPropagation(); handlePreviewCharacter(char); }} 
                                                          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isPlayingPreview ? 'bg-indigo-600 text-white shadow-md' : 'bg-white border border-gray-200 text-indigo-600 hover:bg-indigo-50'}`}
                                                      >
                                                          {isLoadingPreview ? <Loader2 size={18} className="animate-spin"/> : isPlayingPreview ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor" className="ml-0.5"/>}
                                                      </button>
                                                 </div>
                                             </div>
                                         );
                                     })}
                                 </div>
                             </>
                        )}

                        {/* --- VOICE GALLERY VIEW --- */}
                        {charTab === 'GALLERY' && (
                             <div className="space-y-6">
                                 {/* Filters */}
                                 <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
                                     <div className="relative w-full md:w-64">
                                         <Search size={16} className="absolute left-3 top-3 text-gray-400"/>
                                         <input 
                                            type="text" 
                                            placeholder="Search voices..." 
                                            value={voiceSearch}
                                            onChange={(e) => setVoiceSearch(e.target.value)}
                                            className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                         />
                                     </div>
                                     
                                     <div className="flex gap-2 w-full md:w-auto overflow-x-auto no-scrollbar">
                                         <select 
                                            value={voiceFilterGender}
                                            onChange={(e) => setVoiceFilterGender(e.target.value as any)}
                                            className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 outline-none cursor-pointer hover:bg-gray-100"
                                         >
                                             <option value="All">All Genders</option>
                                             <option value="Male">Male</option>
                                             <option value="Female">Female</option>
                                         </select>
                                         <select 
                                            value={voiceFilterAccent}
                                            onChange={(e) => setVoiceFilterAccent(e.target.value)}
                                            className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-600 outline-none cursor-pointer hover:bg-gray-100"
                                         >
                                             <option value="All">All Accents</option>
                                             {uniqueAccents.map(a => <option key={a} value={a}>{a}</option>)}
                                         </select>
                                     </div>
                                 </div>

                                 {/* Voice Grid */}
                                 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                     {filteredVoices.map(v => {
                                         const isLoading = previewState?.id === v.id && previewState.status === 'loading';
                                         const isPlaying = previewState?.id === v.id && previewState.status === 'playing';
                                         
                                         return (
                                             <div key={v.id} className="bg-white p-4 rounded-2xl border border-gray-200 hover:border-indigo-200 hover:shadow-md transition-all group flex flex-col gap-3">
                                                 <div className="flex items-center justify-between">
                                                     <div className="flex items-center gap-3">
                                                         <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${v.gender === 'Female' ? 'bg-pink-500' : v.gender === 'Male' ? 'bg-blue-500' : 'bg-purple-500'}`}>
                                                             {v.name[0]}
                                                         </div>
                                                         <div>
                                                             <h4 className="font-bold text-gray-900 text-sm">{v.name}</h4>
                                                             <div className="text-[10px] text-gray-500 font-medium">{v.gender} • {v.accent.split(' ')[0]}</div>
                                                         </div>
                                                     </div>
                                                     
                                                     <button 
                                                        onClick={() => handleVoicePreview(v.id, v.name)}
                                                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${isPlaying ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-indigo-100 hover:text-indigo-600'}`}
                                                     >
                                                         {isLoading ? <Loader2 size={14} className="animate-spin"/> : isPlaying ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>}
                                                     </button>
                                                 </div>
                                                 
                                                 <button 
                                                    onClick={() => openCharacterModal(undefined, v.id)}
                                                    className="w-full py-2 rounded-lg border border-gray-200 text-xs font-bold text-gray-600 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors flex items-center justify-center gap-2"
                                                 >
                                                     <Plus size={14}/> Create Character
                                                 </button>
                                             </div>
                                         )
                                     })}
                                     
                                     {/* Add Clones to Gallery */}
                                     {clonedVoices.filter(c => 
                                         (voiceFilterGender === 'All' || c.gender === voiceFilterGender) &&
                                         (c.name.toLowerCase().includes(voiceSearch.toLowerCase()))
                                     ).map(c => {
                                          const isLoading = previewState?.id === c.id && previewState.status === 'loading';
                                          const isPlaying = previewState?.id === c.id && previewState.status === 'playing';
                                         return (
                                             <div key={c.id} className="bg-gradient-to-br from-amber-50 to-orange-50 p-4 rounded-2xl border border-amber-200 hover:shadow-md transition-all flex flex-col gap-3">
                                                 <div className="flex items-center justify-between">
                                                     <div className="flex items-center gap-3">
                                                         <div className="w-10 h-10 rounded-full bg-amber-500 text-white flex items-center justify-center font-bold text-sm">
                                                             <Fingerprint size={16}/>
                                                         </div>
                                                         <div>
                                                             <h4 className="font-bold text-gray-900 text-sm">{c.name}</h4>
                                                             <div className="text-[10px] text-amber-700 font-bold uppercase tracking-wider">Custom Clone</div>
                                                         </div>
                                                     </div>
                                                     <button 
                                                        onClick={() => handleVoicePreview(c.id, c.name)}
                                                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${isPlaying ? 'bg-amber-600 text-white' : 'bg-white text-amber-600 hover:bg-amber-100'}`}
                                                     >
                                                         {isLoading ? <Loader2 size={14} className="animate-spin"/> : isPlaying ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>}
                                                     </button>
                                                 </div>
                                                  <button 
                                                    onClick={() => openCharacterModal(undefined, c.id)}
                                                    className="w-full py-2 rounded-lg border border-amber-200 bg-white/50 text-xs font-bold text-amber-800 hover:bg-white transition-colors flex items-center justify-center gap-2"
                                                 >
                                                     <Plus size={14}/> Create Character
                                                 </button>
                                             </div>
                                         )
                                     })}
                                 </div>
                             </div>
                        )}

                         {/* ... modal ... */}
                         {characterModalOpen && (
                             <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                                 <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl p-6 animate-in zoom-in duration-200">
                                     <div className="flex justify-between items-center mb-6">
                                         <h3 className="text-lg font-bold">{editingChar ? 'Edit Character' : 'New Character'}</h3>
                                         <button onClick={() => setCharacterModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X size={18}/></button>
                                     </div>
                                     <div className="space-y-4">
                                         {/* ... form fields ... */}
                                         <div className="flex items-center gap-4">
                                             <div className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-sm relative group/color cursor-pointer" style={{ backgroundColor: charForm.avatarColor }}>
                                                  {charForm.name ? charForm.name.substring(0, 2).toUpperCase() : '?'}
                                                  <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={charForm.avatarColor} onChange={e => setCharForm({...charForm, avatarColor: e.target.value})} />
                                             </div>
                                             <div className="flex-1">
                                                 <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Name</label>
                                                 <input value={charForm.name} onChange={e => setCharForm({...charForm, name: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. Narrator, Hero" />
                                             </div>
                                         </div>
                                         
                                         <div className="grid grid-cols-2 gap-4">
                                             <div>
                                                 <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Gender</label>
                                                 <select value={charForm.gender} onChange={e => setCharForm({...charForm, gender: e.target.value as any})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
                                                     <option value="Male">Male</option>
                                                     <option value="Female">Female</option>
                                                     <option value="Unknown">Non-Binary / Other</option>
                                                 </select>
                                             </div>
                                             <div>
                                                 <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Age Group</label>
                                                 <select value={charForm.age} onChange={e => setCharForm({...charForm, age: e.target.value as any})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
                                                     <option value="Child">Child</option>
                                                     <option value="Young Adult">Young Adult</option>
                                                     <option value="Adult">Adult</option>
                                                     <option value="Elderly">Elderly</option>
                                                 </select>
                                             </div>
                                         </div>

                                         <div>
                                              <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Voice</label>
                                              <select value={charForm.voiceId} onChange={e => setCharForm({...charForm, voiceId: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none font-medium">
                                                  <optgroup label="Standard Voices">
                                                      {VOICES.map(v => <option key={v.id} value={v.id}>{v.name} ({v.gender}, {v.accent})</option>)}
                                                  </optgroup>
                                                  {clonedVoices.length > 0 && (
                                                      <optgroup label="My Clones">
                                                          {clonedVoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                                      </optgroup>
                                                  )}
                                                  {/* Add external options if enabled */}
                                                  {settings.engine === 'OPENAI' && OPENAI_VOICES.length > 0 && (
                                                      <optgroup label="OpenAI">
                                                          {OPENAI_VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                                      </optgroup>
                                                  )}
                                              </select>
                                         </div>

                                         <Button fullWidth onClick={saveCharacter} className="mt-4">{editingChar ? 'Save Changes' : 'Create Character'}</Button>
                                     </div>
                                 </div>
                             </div>
                         )}
                    </div>
                )}
                
                {/* --- NEW: NOVEL ADAPTER TAB --- */}
                {activeTab === Tab.NOVEL && (
                    <div className="max-w-6xl mx-auto animate-in fade-in h-full flex flex-col">
                        <div className="mb-6">
                            <h2 className="text-2xl font-bold text-gray-800">Novel Adapter & Localization</h2>
                            <p className="text-sm text-gray-500">Translate stories while culturally adapting names, places, and context.</p>
                        </div>
                        
                        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[500px]">
                            {/* LEFT: SOURCE */}
                            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
                                <div className="p-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Original Story</span>
                                    <button onClick={() => setNovelInput('')} className="text-gray-400 hover:text-red-500"><Trash2 size={16}/></button>
                                </div>
                                <textarea 
                                    value={novelInput}
                                    onChange={(e) => setNovelInput(e.target.value)}
                                    placeholder="Paste your story chapter here..."
                                    className="flex-1 p-6 resize-none outline-none text-base text-gray-700 leading-relaxed font-serif bg-transparent custom-scrollbar"
                                />
                            </div>

                            {/* RIGHT: OUTPUT & CONTROLS */}
                            <div className="flex flex-col gap-4 h-full">
                                {/* Controls */}
                                <div className="bg-white p-4 rounded-2xl shadow-sm border border-indigo-100 flex flex-col gap-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Target Language</label>
                                            <select 
                                                value={novelTargetLang} 
                                                onChange={(e) => setNovelTargetLang(e.target.value)}
                                                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none"
                                            >
                                                <option value="Hinglish">Hinglish</option>
                                                <option value="English">English</option>
                                                <option value="Hindi">Hindi</option>
                                                <option value="Spanish">Spanish</option>
                                                <option value="Japanese">Japanese</option>
                                                {LANGUAGES.map(l => <option key={l.code} value={l.name}>{l.name}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                             <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Target Culture/Setting</label>
                                             <input 
                                                value={novelTargetCulture}
                                                onChange={(e) => setNovelTargetCulture(e.target.value)}
                                                placeholder="e.g. Mumbai, India or Medieval Japan"
                                                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none"
                                             />
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                                        <div className="flex items-center gap-4">
                                            <span className="text-xs font-bold text-gray-500">Adaptation Mode:</span>
                                            <div className="flex bg-gray-100 p-1 rounded-lg">
                                                <button 
                                                    onClick={() => setNovelAdaptationMode('translate')} 
                                                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${novelAdaptationMode === 'translate' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                                                >
                                                    Direct Translate
                                                </button>
                                                <button 
                                                    onClick={() => setNovelAdaptationMode('adapt')} 
                                                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${novelAdaptationMode === 'adapt' ? 'bg-indigo-600 shadow-sm text-white' : 'text-gray-500'}`}
                                                >
                                                    Full Cultural Adapt
                                                </button>
                                            </div>
                                        </div>
                                        
                                        <Button 
                                            onClick={handleAdaptNovel} 
                                            disabled={isAdaptingNovel} 
                                            className="bg-gradient-to-r from-indigo-600 to-purple-600"
                                        >
                                            {isAdaptingNovel ? <Loader2 size={16} className="animate-spin mr-2"/> : <Wand2 size={16} className="mr-2"/>} 
                                            {isAdaptingNovel ? 'Adapting...' : 'Run Adapter'}
                                        </Button>
                                    </div>
                                </div>

                                {/* Output */}
                                <div className="bg-indigo-50/50 rounded-2xl shadow-sm border border-indigo-100 flex flex-col overflow-hidden flex-1 relative group">
                                     <div className="p-3 border-b border-indigo-100 flex justify-between items-center bg-white/50 backdrop-blur-sm">
                                         <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Adapted Result</span>
                                         {novelOutput && (
                                             <button onClick={sendNovelToStudio} className="text-xs font-bold bg-indigo-600 text-white px-3 py-1.5 rounded-lg flex items-center gap-1 hover:bg-indigo-700 transition-colors shadow-sm">
                                                 <Mic size={12}/> Convert to Audio
                                             </button>
                                         )}
                                     </div>
                                     <textarea 
                                        value={novelOutput}
                                        onChange={(e) => setNovelOutput(e.target.value)}
                                        placeholder="Adaptation result will appear here..."
                                        className="flex-1 p-6 resize-none outline-none text-base text-gray-800 leading-relaxed font-serif bg-transparent custom-scrollbar"
                                    />
                                    {!novelOutput && !isAdaptingNovel && (
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                            <div className="text-center text-gray-400">
                                                <BookOpen size={48} className="mx-auto mb-2 opacity-20"/>
                                                <p className="text-sm font-medium">Ready to adapt your story</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                
                {activeTab === Tab.LAB && (
                     <div className="max-w-2xl mx-auto bg-white p-8 rounded-3xl shadow-sm border border-gray-200 animate-in fade-in">
                         {/* ... Lab Content ... */}
                         <div className="flex justify-center mb-8">
                             <div className="bg-gray-100 p-1 rounded-xl flex">
                                 <button onClick={() => setLabMode('CLONING')} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${labMode === 'CLONING' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>Voice Cloning</button>
                                 <button onClick={() => setLabMode('COVERS')} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${labMode === 'COVERS' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>AI Covers (RVC)</button>
                             </div>
                         </div>
                         {labMode === 'CLONING' && (
                             <div className="space-y-6">
                                 <div className="text-center">
                                     <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl mx-auto flex items-center justify-center mb-4"><Fingerprint size={32}/></div>
                                     <h2 className="text-xl font-bold">Create a Voice Clone</h2>
                                     <p className="text-sm text-gray-500 mt-1">Upload a sample to create a digital replica.</p>
                                 </div>
                                 
                                 <div className="grid grid-cols-1 gap-4">
                                     <div>
                                         <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Voice Name</label>
                                         <input 
                                            value={cloneName} 
                                            onChange={e => setCloneName(e.target.value)} 
                                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                                            placeholder="e.g. My Custom Voice"
                                         />
                                     </div>
                                     <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center hover:bg-gray-50 transition-colors relative cursor-pointer">
                                         <input type="file" accept="audio/*" onChange={(e) => setUploadVoiceFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                         {uploadVoiceFile ? (
                                             <div className="flex items-center justify-center gap-2 text-indigo-600 font-bold">
                                                 <FileAudio size={20} /> {uploadVoiceFile.name}
                                             </div>
                                         ) : (
                                             <div className="text-gray-400">
                                                 <UploadCloud size={24} className="mx-auto mb-2"/>
                                                 <p className="text-xs font-bold">Click to Upload Sample</p>
                                                 <p className="text-[10px]">WAV or MP3, max 10MB</p>
                                             </div>
                                         )}
                                     </div>
                                 </div>

                                 <Button fullWidth onClick={handleVoiceClone} disabled={isGenerating}>{isGenerating ? 'Cloning...' : 'Create Clone'}</Button>
                                 
                                 <div className="bg-blue-50 p-3 rounded-xl text-xs text-blue-800 flex items-start gap-2">
                                     <Sparkles size={14} className="shrink-0 mt-0.5"/>
                                     <span>
                                         <strong>Pro Tip:</strong> For F5-TTS engines, this sample will be used as the zero-shot reference audio every time you generate speech.
                                     </span>
                                 </div>
                             </div>
                         )}
                         {labMode === 'COVERS' && (
                             <div className="text-center py-10">
                                 <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-2xl mx-auto flex items-center justify-center mb-4"><Music size={32}/></div>
                                 <h2 className="text-xl font-bold">AI Covers (RVC)</h2>
                                 <p className="text-sm text-gray-500 mt-2 mb-6">Connect an RVC Backend in Settings to generate AI covers.</p>
                                 <Button onClick={() => setShowSettings(true)} variant="secondary">Open Settings</Button>
                             </div>
                         )}
                     </div>
                )}

                {activeTab === Tab.DUBBING && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in">
                        {/* ... Dubbing UI ... */}
                        <div className="space-y-4">
                             {/* ... Video Player ... */}
                             <div className="bg-black rounded-3xl shadow-sm border border-gray-800 overflow-hidden flex flex-col h-[400px] relative group">
                                {videoUrl ? (
                                    <div className="relative w-full h-full bg-black flex flex-col justify-center">
                                        <video ref={videoRef} src={videoUrl} className="max-h-full max-w-full mx-auto object-contain" controls={false} />
                                        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex flex-col gap-3 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                                            <div className="flex justify-center items-center gap-6">
                                                <button onClick={toggleDubPlayback} className={`p-4 rounded-full text-white transition-all transform hover:scale-110 bg-indigo-600 shadow-lg shadow-indigo-500/50`}>
                                                    {isPlayingDub ? <Pause size={28} fill="currentColor"/> : <Play size={28} fill="currentColor" className="ml-1"/>}
                                                </button>
                                            </div>
                                            {dubAudioUrl && (
                                                <div className="bg-gray-900/80 rounded-xl p-3 flex items-center gap-4 backdrop-blur-md border border-white/10">
                                                     {/* ... mixers ... */}
                                                </div>
                                            )}
                                        </div>
                                        {dubAudioUrl && <audio ref={dubAudioRef} src={dubAudioUrl} className="hidden" />}
                                    </div>
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 p-8 bg-gray-900">
                                        <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mb-4 animate-pulse"><UploadCloud size={32} className="text-indigo-400"/></div>
                                        <p className="font-bold text-gray-300">Upload Video Source</p>
                                        <div className="relative group/btn mt-6"><input type="file" accept="video/*" onChange={handleVideoUpload} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" /><Button variant="secondary">Select File</Button></div>
                                    </div>
                                )}
                            </div>
                            {/* ... Detected Cast Dubbing ... */}
                        </div>

                        {/* Right Column: Scripting & Generation */}
                        <div className="space-y-4 h-full flex flex-col">
                             <div className="bg-white rounded-3xl shadow-sm border border-gray-200 flex-1 flex flex-col overflow-hidden min-h-[400px]">
                                 {/* NEW DUBBING TOOLBAR - Fixes Missing Translate Button */}
                                 <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
                                      <div className="flex items-center gap-1">
                                          <button onClick={() => handleTranslateVideo('transcribe')} disabled={!videoFile || isProcessingVideo} className="p-1.5 text-xs font-bold text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg flex items-center gap-1 transition-colors" title="Transcribe Video (Original Language)">
                                              {isProcessingVideo ? <Loader2 size={14} className="animate-spin"/> : <FileText size={14}/>} <span className="hidden sm:inline">Transcribe</span>
                                          </button>
                                          <div className="w-px h-4 bg-gray-300 mx-1 opacity-50"></div>
                                          
                                          {/* PROOFREAD TOOLBAR for Dubbing */}
                                          <div className="flex items-center gap-0.5 bg-teal-50 rounded-lg border border-teal-100 p-0.5">
                                            <button 
                                                onClick={() => handleProofread('grammar')} 
                                                disabled={isAiWriting} 
                                                className="p-1.5 text-xs font-bold text-teal-700 hover:bg-white hover:shadow-sm rounded-md transition-all flex items-center gap-1" 
                                                title="Strict Grammar Check"
                                            >
                                                <SpellCheck size={14}/>
                                            </button>
                                            <div className="w-px h-3 bg-teal-200"></div>
                                            <button 
                                                onClick={() => handleProofread('flow')} 
                                                disabled={isAiWriting} 
                                                className="p-1.5 text-xs font-bold text-teal-700 hover:bg-white hover:shadow-sm rounded-md transition-all flex items-center gap-1" 
                                                title="Optimize Flow & Naturalness"
                                            >
                                                <BookOpenCheck size={14}/> <span className="hidden sm:inline">Flow</span>
                                            </button>
                                            <div className="w-px h-3 bg-teal-200"></div>
                                            <button 
                                                onClick={() => handleProofread('novel')} 
                                                disabled={isAiWriting} 
                                                className="p-1.5 text-xs font-bold text-teal-700 hover:bg-white hover:shadow-sm rounded-md transition-all flex items-center gap-1" 
                                                title="Enhance for Audio Novel (Advanced)"
                                            >
                                                <Book size={14}/> <span className="hidden sm:inline">Novel</span>
                                            </button>
                                          </div>

                                          <div className="w-px h-4 bg-gray-300 mx-1 opacity-50"></div>
                                          <button onClick={() => setDubScript('')} className="p-1.5 text-xs font-bold text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Clear"><Trash2 size={14}/></button>
                                      </div>
                                      
                                      <div className="flex items-center gap-2 shrink-0">
                                         <button onClick={() => handleDirectorAI(dubScript, setDubScript, 'video_dub')} disabled={isAiWriting} className="text-xs font-bold bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-indigo-200 disabled:opacity-50 transition-colors shadow-sm shadow-indigo-200/50">
                                            {isAiWriting ? <Loader2 size={13} className="animate-spin"/> : <Wand2 size={13}/>} 
                                            <span>Auto Format</span>
                                         </button>
                                    </div>
                                 </div>
                                 
                                 {/* DUBBING TRANSLATION BAR */}
                                 <div className="px-4 py-2 bg-gradient-to-r from-blue-50/80 to-indigo-50/80 backdrop-blur-sm border-b border-gray-100 flex items-center justify-between gap-2 relative z-10">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <Globe size={14} className="text-blue-600 shrink-0"/>
                                        <div className="flex items-center gap-1 bg-white rounded-lg border border-blue-100 p-0.5 shadow-sm overflow-x-auto no-scrollbar">
                                            <select 
                                                value={targetLang}
                                                onChange={(e) => setTargetLang(e.target.value)}
                                                className="px-2 py-1 text-[10px] font-bold bg-transparent outline-none text-gray-700 hover:text-gray-900 cursor-pointer min-w-[80px]"
                                            >
                                                <option value="Hinglish">Hinglish</option>
                                                <option value="English">English</option>
                                                <option value="Hindi">Hindi</option>
                                                <option value="Spanish">Spanish</option>
                                                <option value="French">French</option>
                                                <option value="German">German</option>
                                                <option value="Japanese">Japanese</option>
                                                <option value="Korean">Korean</option>
                                                {/* Fallback for other languages */}
                                                {LANGUAGES.filter(l => !['Hinglish', 'English', 'Hindi', 'Spanish', 'French', 'German', 'Japanese', 'Korean'].includes(l.name)).map(l => (
                                                    <option key={l.code} value={l.name}>{l.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => handleTranslate()}
                                            disabled={isAiWriting || !dubScript}
                                            className="text-[10px] font-bold text-gray-600 hover:bg-gray-100 px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap"
                                            title="Translate existing text in editor"
                                        >
                                            <Type size={12}/> Text
                                        </button>
                                        <button 
                                            onClick={() => handleTranslateVideo('translate')}
                                            disabled={!videoFile || isProcessingVideo}
                                            className="text-[10px] font-bold text-blue-600 hover:bg-blue-100 px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap"
                                            title="Translate audio from video file"
                                        >
                                            <FileAudio size={12}/> Audio
                                        </button>
                                    </div>
                                </div>

                                 <textarea 
                                    value={dubScript} 
                                    onChange={(e) => setDubScript(e.target.value)} 
                                    placeholder="Enter script or transcribe video..." 
                                    className="flex-1 p-6 resize-none outline-none text-base text-gray-700 leading-relaxed font-mono bg-transparent custom-scrollbar" 
                                 />
                                 
                                 <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                                     <div className="w-full">
                                         <Button 
                                            onClick={handleGenerateDub} 
                                            disabled={isGenerating || !dubScript} 
                                            fullWidth 
                                            className="shadow-lg shadow-indigo-200 bg-gradient-to-r from-blue-600 to-indigo-600"
                                         >
                                             {isGenerating ? <><Loader2 className="animate-spin mr-2"/> Processing Dub...</> : <><Film size={18} className="mr-2"/> Generate Dub Track</>}
                                         </Button>
                                     </div>
                                 </div>
                             </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
      </main>

      {/* Floating AI Assistant */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4">
          {isChatOpen && (
              <div className="w-80 h-[450px] bg-white rounded-2xl shadow-2xl border border-white/50 backdrop-blur-xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300 relative z-50 ring-1 ring-gray-100">
                  {/* ... Chat UI ... */}
                  <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-3 flex items-center justify-between text-white relative overflow-hidden">
                      <div className="flex items-center gap-2 font-bold text-sm relative z-10"><Sparkles size={16} className="text-yellow-300"/> Creative Assistant</div>
                      <button onClick={() => setIsChatOpen(false)} className="hover:bg-white/20 p-1 rounded-full relative z-10"><X size={14}/></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/80 custom-scrollbar">
                      {chatHistory.map((msg, i) => (
                          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                              <div className={`max-w-[90%] p-3 rounded-2xl text-xs leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white border border-gray-200 text-gray-700 rounded-bl-none'}`}>{msg.text}</div>
                          </div>
                      ))}
                      <div ref={chatEndRef} />
                  </div>
                  <form onSubmit={handleChatSubmit} className="p-3 bg-white border-t border-gray-100 flex gap-2">
                      <input className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none" placeholder="Message..." value={chatInput} onChange={e => setChatInput(e.target.value)} />
                      <button disabled={isChatLoading} type="submit" className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"><Send size={14}/></button>
                  </form>
              </div>
          )}
          
          <button onClick={() => setIsChatOpen(!isChatOpen)} className="group relative w-16 h-16 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-2xl shadow-indigo-400/50">
              <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 animate-ping opacity-20 duration-1000"></span>
              <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 ring-4 ring-white/30"></span>
              <div className="relative z-10 text-white transform transition-transform group-hover:rotate-12">{isChatOpen ? <X size={28} strokeWidth={3}/> : <Sparkles size={28} fill="currentColor" className="animate-pulse"/>}</div>
          </button>
      </div>

      {/* Resource Monitor */}
      <ResourceMonitor isWorking={isGenerating || isProcessingVideo || isAiWriting || isChatLoading} />

      {/* Modals & Overlays */}
      {isGenerating && (
          <GenerationWidget 
              progress={progress} 
              timeLeft={Math.ceil(timeLeft)} 
              stage={processingStage} 
              onCancel={handleCancelGeneration} // Added Cancel Handler
          />
      )}
      {showSettings && <SettingsPanel />}
      <AdModal isOpen={showAdModal} onClose={() => setShowAdModal(false)} onReward={() => { updateStats({ generationsUsed: Math.max(0, stats.generationsUsed - 1) }); setShowAdModal(false); showToast("Reward granted!", "success"); }} />
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};
// Add missing StoreIcon component definition (it was used in the redesign)
const StoreIcon = ({ size, className }: { size?: number, className?: string }) => (
    <svg 
      width={size || 24} 
      height={size || 24} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      className={className}
    >
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
      <path d="M2 7h20" />
      <path d="M22 7v3a2 2 0 0 1-2 2v0a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12v0a2 2 0 0 1-2-2V7" />
    </svg>
);
