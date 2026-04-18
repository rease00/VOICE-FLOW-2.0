'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Target, Flame, TrendingUp, Trophy, Sparkles } from 'lucide-react';

interface WritingGoalTrackerProps {
  currentWordCount: number;
  sessionStartWordCount: number;
}

interface WritingSession {
  date: string;
  wordsWritten: number;
  goalMet: boolean;
}

const GOAL_STORAGE_KEY = 'vf_writing_goals';
const SESSION_STORAGE_KEY = 'vf_writing_sessions';

const loadGoal = (): number => {
  if (typeof window === 'undefined') return 1000;
  try {
    const stored = localStorage.getItem(GOAL_STORAGE_KEY);
    return stored ? Math.max(0, parseInt(stored, 10)) || 1000 : 1000;
  } catch {
    return 1000;
  }
};

const saveGoal = (goal: number) => {
  try {
    localStorage.setItem(GOAL_STORAGE_KEY, String(goal));
  } catch {}
};

const loadSessions = (): WritingSession[] => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const saveSessions = (sessions: WritingSession[]) => {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions.slice(-90)));
  } catch {}
};

const todayKey = (): string => new Date().toISOString().split('T')[0] ?? new Date().toISOString().slice(0, 10);

export const WritingGoalTracker: React.FC<WritingGoalTrackerProps> = ({
  currentWordCount,
  sessionStartWordCount,
}) => {
  const [dailyGoal, setDailyGoal] = useState(loadGoal);
  const [sessions, setSessions] = useState<WritingSession[]>(loadSessions);
  const [showCelebration, setShowCelebration] = useState(false);
  const prevGoalMetRef = useRef(false);
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState(String(dailyGoal));

  const wordsWrittenThisSession = Math.max(0, currentWordCount - sessionStartWordCount);

  const todaySession = sessions.find(s => s.date === todayKey());
  const todayWordsWritten = todaySession?.wordsWritten ?? 0;
  const totalWordsToday = todayWordsWritten + wordsWrittenThisSession;
  const goalProgress = Math.min(1, totalWordsToday / Math.max(1, dailyGoal));
  const goalMet = totalWordsToday >= dailyGoal;
  const streak = calculateStreak(sessions, dailyGoal);

  useEffect(() => {
    if (goalMet && !prevGoalMetRef.current) {
      setShowCelebration(true);
      const timer = setTimeout(() => setShowCelebration(false), 4000);
      return () => clearTimeout(timer);
    }
    prevGoalMetRef.current = goalMet;
  }, [goalMet]);

  useEffect(() => {
    const key: string = todayKey();
    setSessions(prev => {
      const existing = prev.findIndex(s => s.date === key);
      if (existing >= 0) {
        const next = [...prev];
        const current = next[existing];
        if (current) {
          next[existing] = { date: current.date, wordsWritten: totalWordsToday, goalMet };
        }
        return next;
      }
      return [...prev, { date: key, wordsWritten: totalWordsToday, goalMet }];
    });
  }, [totalWordsToday, goalMet]);

  const handleSaveGoal = () => {
    const parsed = parseInt(goalInput, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      setDailyGoal(parsed);
      saveGoal(parsed);
    }
    setIsEditingGoal(false);
  };

  const circumference = 2 * Math.PI * 28;
  const strokeDashoffset = circumference * (1 - goalProgress);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Daily Goal</h4>
        <button
          onClick={() => { setGoalInput(String(dailyGoal)); setIsEditingGoal(true); }}
          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          Edit
        </button>
      </div>

      {isEditingGoal && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            type="number"
            value={goalInput}
            onChange={e => setGoalInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveGoal(); if (e.key === 'Escape') setIsEditingGoal(false); }}
            className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-slate-500">words</span>
          <button onClick={handleSaveGoal} className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">Save</button>
        </div>
      )}

      {/* Progress ring */}
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16 shrink-0">
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
            <circle
              cx="32" cy="32" r="28" fill="none"
              stroke={goalMet ? '#10b981' : '#3b82f6'}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-700 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[11px] font-bold text-white">{Math.round(goalProgress * 100)}%</span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-white">{totalWordsToday.toLocaleString()} / {dailyGoal.toLocaleString()}</p>
          <p className="text-[10px] text-slate-500">{wordsWrittenThisSession.toLocaleString()} words this session</p>
          {goalMet && (
            <p className="text-[10px] text-emerald-400 flex items-center gap-1">
              <Trophy size={10} /> Goal reached!
            </p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-800/60 rounded-lg p-2.5 border border-white/5">
          <div className="flex items-center gap-1.5 mb-1">
            <Flame size={11} className="text-orange-400" />
            <span className="text-[10px] text-slate-500">Streak</span>
          </div>
          <p className="text-sm font-semibold text-white">{streak} day{streak !== 1 ? 's' : ''}</p>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2.5 border border-white/5">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={11} className="text-blue-400" />
            <span className="text-[10px] text-slate-500">Session</span>
          </div>
          <p className="text-sm font-semibold text-white">{wordsWrittenThisSession.toLocaleString()} words</p>
        </div>
      </div>

      {/* Celebration overlay */}
      {showCelebration && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 animate-bounce">
            <Sparkles size={40} className="text-yellow-400" />
            <p className="text-lg font-bold text-yellow-300">Daily goal reached!</p>
          </div>
        </div>
      )}
    </div>
  );
};

function calculateStreak(sessions: WritingSession[], goal: number): number {
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().split('T')[0];
    const session = sessions.find(s => s.date === key);
    if (session && session.wordsWritten >= goal) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}
