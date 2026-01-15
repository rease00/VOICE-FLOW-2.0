
import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { UserStats, UserContextType, UserProfile, HistoryItem, ClonedVoice, Draft, GenerationSettings, CharacterProfile } from '../types';
import { INITIAL_STATS, VOICES } from '../constants';
import { supabase } from '../services/supabaseClient';

// Extend context type to include sync logic
interface ExtendedUserContextType extends UserContextType {
  syncCast: (cast: string[] | CharacterProfile[]) => void;
  isSyncing: boolean;
}

const UserContext = createContext<ExtendedUserContextType | undefined>(undefined);

// --- PRE-BUILT DEFAULT CHARACTERS (The Store) ---
const DEFAULT_CHARACTERS: CharacterProfile[] = [
  { 
    id: 'def_narrator', 
    name: 'Narrator', 
    voiceId: 'v1', // David (Gemini: Fenrir)
    gender: 'Male', 
    age: 'Adult', 
    avatarColor: '#3b82f6', 
    description: 'Standard storytelling voice, neutral tone.' 
  },
  { 
    id: 'def_host', 
    name: 'Host', 
    voiceId: 'v2', // Sarah (Gemini: Kore)
    gender: 'Female', 
    age: 'Young Adult', 
    avatarColor: '#ec4899', 
    description: 'Energetic podcast host.' 
  }
];

// --- COMPRESSION HELPERS (Minification for DB Storage) ---
const compressCharacterData = (c: CharacterProfile) => {
  const gMap: Record<string, number> = { 'Unknown': 0, 'Male': 1, 'Female': 2 };
  const aMap: Record<string, number> = { 'Child': 1, 'Young Adult': 2, 'Adult': 3, 'Elderly': 4 };
  
  return {
    n: c.name,
    v: c.voiceId,
    g: gMap[c.gender || 'Unknown'] ?? 0,
    a: aMap[c.age || 'Adult'] ?? 3,
    c: c.avatarColor,
    d: c.description
  };
};

const decompressCharacterData = (id: string, data: any): CharacterProfile => {
  const gMap = ['Unknown', 'Male', 'Female'];
  const aMap = ['Unknown', 'Child', 'Young Adult', 'Adult', 'Elderly'];
  
  return {
    id: id,
    name: data.n || 'Unknown',
    voiceId: data.v || 'v1',
    gender: (gMap[data.g] as any) || 'Unknown',
    age: (aMap[data.a] as any) || 'Adult',
    avatarColor: data.c || '#6366f1',
    description: data.d || ''
  };
};

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [stats, setStats] = useState<UserStats>(INITIAL_STATS);
  const [user, setUser] = useState<UserProfile>({ name: '', email: '', googleId: '' });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [clonedVoices, setClonedVoices] = useState<ClonedVoice[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  
  const loadJSON = (key: string, fallback: any) => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : fallback;
    } catch (e) { return fallback; }
  };

  const [characterLibrary, setCharacterLibrary] = useState<CharacterProfile[]>(() => {
      const local = loadJSON('vf_character_lib', []);
      return local.length > 0 ? local : DEFAULT_CHARACTERS;
  });

  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const guestUser: UserProfile = {
    name: 'Guest Artist',
    email: 'guest@voiceflow.ai',
    googleId: 'guest_mode'
  };

  const safeSetItem = (key: string, value: any) => {
    try {
      const cache = new Set();
      const json = JSON.stringify(value, (k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (cache.has(v)) return;
          cache.add(v);
        }
        return v;
      });
      localStorage.setItem(key, json);
    } catch (e) {}
  };

  // --- SUPABASE SYNC LOGIC ---

  const syncLocalToSupabase = async (localChars: CharacterProfile[], userId: string) => {
      if (localChars.length === 0) return;
      const updates = localChars.map(c => ({
          id: c.id,
          user_id: userId,
          data: compressCharacterData(c),
          updated_at: new Date().toISOString()
      }));
      const { error } = await supabase.from('characters').upsert(updates);
      if (error) console.error("Sync Local->DB Failed", error);
  };

  const fetchCharactersFromSupabase = async (userId: string, localFallback: CharacterProfile[] = []) => {
      setIsSyncing(true);
      try {
          const { data: remoteData, error } = await supabase
              .from('characters')
              .select('id, data')
              .eq('user_id', userId);
          
          if (error) throw error;
          
          const finalLibrary: CharacterProfile[] = [];
          const remoteIds = new Set<string>();

          if (remoteData) {
              remoteData.forEach((row: any) => {
                  const char = decompressCharacterData(row.id, row.data);
                  finalLibrary.push(char);
                  remoteIds.add(char.id);
              });
          }

          // Merge Local (Guest) Characters or Fallbacks
          const charsToUpload = localFallback.filter(l => !remoteIds.has(l.id));
          if (charsToUpload.length > 0) {
              await syncLocalToSupabase(charsToUpload, userId);
              finalLibrary.push(...charsToUpload);
          }
          
          const hasNarrator = finalLibrary.some(c => c.name.toLowerCase() === 'narrator');
          if (!hasNarrator) {
             const narrator = DEFAULT_CHARACTERS.find(c => c.name === 'Narrator')!;
             finalLibrary.unshift(narrator);
             await syncLocalToSupabase([narrator], userId);
          }
          const hasHost = finalLibrary.some(c => c.name.toLowerCase() === 'host');
          if (!hasHost) {
             const host = DEFAULT_CHARACTERS.find(c => c.name === 'Host')!;
             finalLibrary.push(host);
             await syncLocalToSupabase([host], userId);
          }

          setCharacterLibrary(finalLibrary);
          safeSetItem('vf_character_lib', finalLibrary);
      } catch (e) {
          console.warn("Supabase fetch failed, utilizing local cache:", e);
          if (characterLibrary.length === 0 && localFallback.length === 0) {
              setCharacterLibrary(DEFAULT_CHARACTERS);
          }
      } finally {
          setIsSyncing(false);
      }
  };

  const saveCharacterToSupabase = async (char: CharacterProfile, userId: string) => {
      const compressed = compressCharacterData(char);
      try {
          await supabase.from('characters').upsert({
              id: char.id, 
              user_id: userId,
              data: compressed,
              updated_at: new Date().toISOString()
          });
      } catch (e) {
          console.error("Failed to save character to DB:", e);
      }
  };

  const deleteCharacterFromSupabase = async (charId: string, userId: string) => {
      try {
          await supabase.from('characters').delete().match({ id: charId, user_id: userId });
      } catch (e) {
          console.error("Failed to delete character from DB:", e);
      }
  };

  // --- INITIALIZATION ---

  useEffect(() => {
    const isGuest = localStorage.getItem('vf_is_guest') === 'true';
    if (isGuest) {
      setUser(guestUser);
    }

    setClonedVoices(loadJSON('vf_clones', []));
    setDrafts(loadJSON('vf_drafts', []));
    
    setHistory(loadJSON('vf_history', []).map((item: any) => ({
        ...item, 
        audioUrl: item.audioUrl?.startsWith('blob:') ? '' : item.audioUrl 
    })));
    
    const storedStats = loadJSON('vf_stats', INITIAL_STATS);
    if (storedStats.lastResetDate !== new Date().toDateString() && !storedStats.isPremium) {
       storedStats.generationsUsed = 0;
       storedStats.lastResetDate = new Date().toDateString();
    }
    setStats(storedStats);

    const localChars = loadJSON('vf_character_lib', []);
    if (localChars.length === 0) {
        setCharacterLibrary(DEFAULT_CHARACTERS);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        mapSessionToUser(session);
        localStorage.removeItem('vf_is_guest');
        fetchCharactersFromSupabase(session.user.id, localChars);
      } else if (isGuest) {
        setUser(guestUser);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        mapSessionToUser(session);
        localStorage.removeItem('vf_is_guest');
        const currentLocalChars = loadJSON('vf_character_lib', []);
        fetchCharactersFromSupabase(session.user.id, currentLocalChars);
      } else {
        if (localStorage.getItem('vf_is_guest') !== 'true') {
           setUser({ name: '', email: '', googleId: '' });
           setCharacterLibrary(DEFAULT_CHARACTERS); 
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const mapSessionToUser = (session: any) => {
    if (session?.user) {
      setUser({
        name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0],
        email: session.user.email || '',
        googleId: session.user.id, 
        avatarUrl: session.user.user_metadata?.avatar_url
      });
    }
  };

  useEffect(() => { safeSetItem('vf_stats', stats); }, [stats]);
  useEffect(() => { safeSetItem('vf_history', history); }, [history]);
  useEffect(() => { safeSetItem('vf_clones', clonedVoices); }, [clonedVoices]);
  useEffect(() => { safeSetItem('vf_drafts', drafts); }, [drafts]);
  useEffect(() => { safeSetItem('vf_character_lib', characterLibrary); }, [characterLibrary]);

  const loginAsGuest = () => {
    localStorage.setItem('vf_is_guest', 'true');
    setUser(guestUser);
  };

  const deleteAccount = async () => {
    setStats(INITIAL_STATS);
    setUser({ name: '', email: '', googleId: '' });
    setHistory([]);
    setClonedVoices([]);
    setDrafts([]);
    setCharacterLibrary(DEFAULT_CHARACTERS);
    localStorage.clear();
    await supabase.auth.signOut();
  };

  const updateCharacter = (c: CharacterProfile) => {
    setCharacterLibrary(prev => {
      const userId = user.googleId;
      const isLoggedIn = userId && userId !== 'guest_mode';

      const indexById = prev.findIndex(x => x.id === c.id);
      if (indexById >= 0) {
          const newList = [...prev];
          const updated = { ...newList[indexById], ...c };
          newList[indexById] = updated;
          if (isLoggedIn) saveCharacterToSupabase(updated, userId);
          return newList;
      }
      
      const indexByName = prev.findIndex(x => x.name.toLowerCase() === c.name.toLowerCase());
      if (indexByName >= 0) {
          const newList = [...prev];
          const updated = { ...newList[indexByName], ...c, id: newList[indexByName].id }; 
          newList[indexByName] = updated;
          if (isLoggedIn) saveCharacterToSupabase(updated, userId);
          return newList;
      }

      const newChar = { ...c, id: c.id || crypto.randomUUID() };
      if (isLoggedIn) saveCharacterToSupabase(newChar, userId);
      return [...prev, newChar];
    });
  };

  const deleteCharacter = (id: string) => {
    const userId = user.googleId;
    const isLoggedIn = userId && userId !== 'guest_mode';
    if (DEFAULT_CHARACTERS.some(d => d.id === id)) return;
    setCharacterLibrary(prev => {
        const char = prev.find(c => c.id === id);
        if (char && isLoggedIn) deleteCharacterFromSupabase(id, userId);
        return prev.filter(c => c.id !== id);
    });
  };

  // --- INTELLIGENT VOICE CASTING LOGIC ---
  const syncCast = (cast: string[] | CharacterProfile[]) => {
      if (!cast || cast.length === 0) return;
      const userId = user.googleId;
      const isLoggedIn = userId && userId !== 'guest_mode';

      setCharacterLibrary(prev => {
          const newList = [...prev];
          let changed = false;
          
          cast.forEach((item, idx) => {
              const name = typeof item === 'string' ? item : item.name;
              const meta = typeof item === 'string' ? null : item;

              if (['scene', 'unknown', 'sfx', 'speaker', 'end', 'start'].includes(name.toLowerCase())) return;

              const existingIdx = newList.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
              
              if (existingIdx === -1) {
                  // NEW CHARACTER - SMART ASSIGNMENT
                  const defaultChar = DEFAULT_CHARACTERS.find(d => d.name.toLowerCase() === name.toLowerCase());
                  
                  let newChar: CharacterProfile;
                  
                  if (defaultChar) {
                      newChar = defaultChar;
                  } else {
                      // DETECT GENDER & AGE PREFERENCE
                      const detectedGender = (meta?.gender as any) || 'Unknown';
                      const detectedAge = (meta?.age as any) || 'Adult';

                      // Filter Voice Pool based on Gender if known
                      let voicePool = VOICES;
                      if (detectedGender === 'Male') voicePool = VOICES.filter(v => v.gender === 'Male');
                      else if (detectedGender === 'Female') voicePool = VOICES.filter(v => v.gender === 'Female');
                      
                      // Fallback if pool empty
                      if (voicePool.length === 0) voicePool = VOICES;

                      // Deterministic but rotated selection based on list length
                      const voiceIndex = (newList.length + idx) % voicePool.length;
                      const assignedVoice = voicePool[voiceIndex];

                      const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e'];
                      const color = colors[Math.floor(Math.random() * colors.length)];

                      newChar = {
                          id: crypto.randomUUID(),
                          name: name,
                          voiceId: assignedVoice.id,
                          gender: detectedGender,
                          age: detectedAge,
                          avatarColor: color,
                          description: 'Auto-added from script'
                      };
                  }
                  
                  newList.push(newChar);
                  changed = true;
                  if (isLoggedIn) saveCharacterToSupabase(newChar, userId);
              } else {
                  // UPDATE EXISTING METADATA
                  const existing = newList[existingIdx];
                  if (meta && (existing.gender === 'Unknown' || !existing.gender) && meta.gender && meta.gender !== 'Unknown') {
                       const updated = { ...existing, gender: meta.gender as any, age: meta.age as any || existing.age };
                       newList[existingIdx] = updated;
                       changed = true;
                       if (isLoggedIn) saveCharacterToSupabase(updated, userId);
                  }
              }
          });
          return changed ? newList : prev;
      });
  };

  return (
    <UserContext.Provider value={{ 
      user, updateUser: (u) => setUser(p => ({...p, ...u})),
      stats, updateStats: (s) => setStats(p => ({...p, ...s})),
      history, addToHistory: (h) => setHistory(p => [h, ...p]), clearHistory: () => { setHistory([]); localStorage.removeItem('vf_history'); },
      deleteAccount,
      clonedVoices, addClonedVoice: (v) => setClonedVoices(p => [v, ...p]),
      drafts, saveDraft: (n, t, s) => setDrafts(p => [{id: Date.now().toString(), name: n, text: t, settings: s, lastModified: Date.now()}, ...p]), deleteDraft: (id) => setDrafts(p => p.filter(d => d.id !== id)),
      showSubscriptionModal, setShowSubscriptionModal,
      watchAd: async () => { if(stats.generationsUsed > 0) setStats(p => ({...p, generationsUsed: p.generationsUsed - 1})); },
      characterLibrary, 
      updateCharacter,
      deleteCharacter,
      getVoiceForCharacter: (n) => characterLibrary.find(c => c.name.toLowerCase() === n.toLowerCase())?.voiceId,
      loginAsGuest,
      syncCast,
      isSyncing
    }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used within a UserProvider');
  return context;
};
