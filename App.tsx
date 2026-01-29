
import React, { useState, useEffect, useRef } from 'react';
import { Send, Plus, MessageSquare, Trash2, Menu, Sparkles, LogOut, Facebook, Zap, RefreshCcw, Settings, Mail, CheckCircle2, ShieldAlert, Calendar, Instagram, UserCircle, Heart, AlertTriangle } from 'lucide-react';
import { ChatSession, Message, UserProfile, Gender } from './types';
import { streamChatResponse, checkApiHealth } from './services/geminiService';
import * as db from './services/firebaseService';

const App: React.FC = () => {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiStatusText, setApiStatusText] = useState<string>('Ready');
  const [connectionHealth, setConnectionHealth] = useState<'perfect' | 'warning' | 'error'>('perfect');
  const [isSyncing, setIsSyncing] = useState(false);
  const [dbStatus, setDbStatus] = useState<boolean>(db.isDatabaseEnabled());
  
  const [onboardingStep, setOnboardingStep] = useState<1 | 2 | 4>(1);
  const [tempAge, setTempAge] = useState<string>('');
  const [tempGender, setTempGender] = useState<Gender | null>(null);
  const [customKeyInput, setCustomKeyInput] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId, isLoading]);

  useEffect(() => {
    const bootApp = async () => {
      setApiStatusText('Booting...');
      const localProfileStr = localStorage.getItem('utsho_profile');
      if (localProfileStr) {
        const localProfile = JSON.parse(localProfileStr) as UserProfile;
        setUserProfile(localProfile);
        setCustomKeyInput(localProfile.customApiKey || '');
        setOnboardingStep(4);
        
        if (db.isDatabaseEnabled()) {
          setIsSyncing(true);
          try {
            const cloudProfile = await db.getUserProfile(localProfile.email);
            if (cloudProfile) {
              setUserProfile(cloudProfile);
              setCustomKeyInput(cloudProfile.customApiKey || '');
              localStorage.setItem('utsho_profile', JSON.stringify(cloudProfile));
            }
            const cloudSessions = await db.getSessions(localProfile.email);
            setSessions(cloudSessions);
            if (cloudSessions.length > 0) setActiveSessionId(cloudSessions[0].id);
          } catch (e) {
            console.error("Boot sync error:", e);
          } finally {
            setIsSyncing(false);
          }
        }
        await performHealthCheck(localProfile);
      }
    };
    bootApp();
  }, []);

  const handleGoogleLogin = async () => {
    try {
      setIsSyncing(true);
      const googleUser = await db.loginWithGoogle();
      if (googleUser) {
        const existingCloudProfile = await db.getUserProfile(googleUser.email);
        if (existingCloudProfile) {
          setUserProfile(existingCloudProfile);
          localStorage.setItem('utsho_profile', JSON.stringify(existingCloudProfile));
          setCustomKeyInput(existingCloudProfile.customApiKey || '');
          setOnboardingStep(4);
          const cloudSessions = await db.getSessions(googleUser.email);
          setSessions(cloudSessions);
          if (cloudSessions.length > 0) setActiveSessionId(cloudSessions[0].id);
          else createNewSession(googleUser.email);
          await performHealthCheck(existingCloudProfile);
        } else {
          setUserProfile(googleUser);
          setTempAge(googleUser.age?.toString() || '20');
          setTempGender(googleUser.gender);
          setOnboardingStep(2);
        }
      }
    } catch (e: any) {
      alert(`Login failed: ${e.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const finalizePersonalization = async () => {
    if (!userProfile || !tempGender || !tempAge) return;
    setIsSyncing(true);
    const finalProfile: UserProfile = {
      ...userProfile,
      age: parseInt(tempAge) || 20,
      gender: tempGender,
      picture: `https://ui-avatars.com/api/?name=${userProfile.name}&background=${tempGender === 'male' ? '4f46e5' : 'db2777'}&color=fff`
    };
    setUserProfile(finalProfile);
    localStorage.setItem('utsho_profile', JSON.stringify(finalProfile));
    if (dbStatus) await db.saveUserProfile(finalProfile);
    setOnboardingStep(4);
    createNewSession(finalProfile.email);
    setIsSyncing(false);
    await performHealthCheck(finalProfile);
  };

  const performHealthCheck = async (profile?: UserProfile) => {
    setApiStatusText('Checking Node...');
    const targetProfile = profile || userProfile || undefined;
    const isHealthy = await checkApiHealth(targetProfile);
    setConnectionHealth(isHealthy ? 'perfect' : 'error');
    setApiStatusText(isHealthy ? 'Active' : 'Node Error');
  };

  const saveSettings = async () => {
    if (!userProfile) return;
    setIsSyncing(true);
    const updated = { ...userProfile, customApiKey: customKeyInput.trim() };
    setUserProfile(updated);
    localStorage.setItem('utsho_profile', JSON.stringify(updated));
    if (dbStatus) await db.saveUserProfile(updated);
    setIsSyncing(false);
    setIsSettingsOpen(false);
    await performHealthCheck(updated);
  };

  const createNewSession = (emailOverride?: string) => {
    const email = emailOverride || userProfile?.email;
    if (!email) return;
    const emptySession = sessions.find(s => s.messages.length === 0);
    if (emptySession) {
      setActiveSessionId(emptySession.id);
      if (window.innerWidth < 768) setIsSidebarOpen(false);
      return;
    }
    const newSession: ChatSession = { id: crypto.randomUUID(), title: 'New Chat', messages: [], createdAt: new Date() };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
    if (dbStatus) db.saveSession(email, newSession);
  };

  const handleDeleteSession = async (e: React.MouseEvent, sid: string) => {
    e.stopPropagation();
    if (!userProfile) return;
    const remaining = sessions.filter(s => s.id !== sid);
    setSessions(remaining);
    if (activeSessionId === sid) setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
    if (dbStatus) await db.deleteSession(userProfile.email, sid);
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading || !activeSessionId || !userProfile) return;
    const currentSession = sessions.find(s => s.id === activeSessionId);
    if (!currentSession) return;

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: inputText, timestamp: new Date() };
    const historySnapshot = [...(currentSession.messages || []), userMessage];
    
    setInputText('');
    setIsLoading(true);

    // Initial state with user message and empty model bubble
    setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: [...historySnapshot], title: s.messages.length === 0 ? userMessage.content.slice(0, 25) : s.title } : s));

    let accumulatedText = "";
    
    await streamChatResponse(
      historySnapshot,
      userProfile,
      (chunk) => {
        accumulatedText += chunk;
        const parts = accumulatedText.split('[SPLIT]').map(p => p.trim()).filter(p => p.length > 0);
        
        setSessions(prev => prev.map(s => {
          if (s.id === activeSessionId) {
            // Create a temporary set of messages for each split part
            const newModelMessages: Message[] = parts.map((part, i) => ({
              id: `stream-${i}`,
              role: 'model',
              content: part,
              timestamp: new Date()
            }));
            return { ...s, messages: [...historySnapshot, ...newModelMessages] };
          }
          return s;
        }));
      },
      (fullText) => {
        setIsLoading(false);
        const parts = fullText.split('[SPLIT]').map(p => p.trim()).filter(p => p.length > 0);
        const finalMessages: Message[] = [
          ...historySnapshot,
          ...parts.map((p, i) => ({ id: crypto.randomUUID(), role: 'model' as const, content: p, timestamp: new Date(Date.now() + i * 50) }))
        ];
        
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: finalMessages } : s));
        if (dbStatus) db.updateSessionMessages(userProfile.email, activeSessionId, finalMessages);
      },
      (error) => {
        setIsLoading(false);
        const errorMsg = `⚠️ ${error.message || "Failed to connect."}`;
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: [...s.messages, { id: crypto.randomUUID(), role: 'model', content: errorMsg, timestamp: new Date() }] } : s));
      },
      (status) => setApiStatusText(status)
    );
  };

  if (onboardingStep === 1) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-[2.5rem] p-10 shadow-2xl space-y-8 animate-in fade-in zoom-in duration-300">
          <div className="text-center space-y-6">
            <div className="flex justify-center"><div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white floating-ai shadow-[0_0_20px_rgba(79,70,229,0.4)]"><Sparkles size={32} /></div></div>
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-tight">Utsho AI</h1>
              <p className="text-zinc-500 text-sm">Snappy • Private • Shakkhor Digital</p>
            </div>
            <button onClick={handleGoogleLogin} disabled={isSyncing} className="w-full bg-white text-zinc-950 font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-zinc-100 transition-all active:scale-95 disabled:opacity-50">
              {isSyncing ? <RefreshCcw size={20} className="animate-spin" /> : <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="" />}
              {isSyncing ? 'Connecting...' : 'Sign in with Google'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (onboardingStep === 2 && userProfile) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-[2.5rem] p-10 shadow-2xl space-y-10 animate-in fade-in zoom-in duration-300">
          <div className="text-center space-y-3">
            <h1 className="text-3xl font-black tracking-tight flex items-center justify-center gap-2"><UserCircle className="text-indigo-500" /> Personalize</h1>
          </div>
          <div className="space-y-8">
            <div className="space-y-3">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">How old are you?</label>
              <input type="number" value={tempAge} onChange={e => setTempAge(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl py-4 px-6 outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => setTempGender('male')} className={`p-6 rounded-3xl border-2 transition-all ${tempGender === 'male' ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-800 bg-zinc-800/50'}`}>👦 Male</button>
              <button onClick={() => setTempGender('female')} className={`p-6 rounded-3xl border-2 transition-all ${tempGender === 'female' ? 'border-pink-500 bg-pink-500/10' : 'border-zinc-800 bg-zinc-800/50'}`}>👧 Female</button>
            </div>
            <button onClick={finalizePersonalization} className="w-full bg-white text-zinc-950 font-black py-4 rounded-2xl shadow-xl">Start Chatting</button>
          </div>
        </div>
      </div>
    );
  }

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const isUserAdmin = userProfile ? db.isAdmin(userProfile.email) : false;
  const isUserDebi = userProfile ? db.isDebi(userProfile.email) : false;

  if (!userProfile || onboardingStep !== 4) return null;

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-['Hind_Siliguri',_sans-serif]">
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
            <h3 className="text-xl font-bold">Settings</h3>
            <input type="password" value={customKeyInput} onChange={e => setCustomKeyInput(e.target.value)} placeholder="Personal Gemini Key" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 outline-none" />
            <button onClick={saveSettings} className="w-full py-3 font-bold bg-indigo-600 rounded-xl">Save Key</button>
          </div>
        </div>
      )}

      <aside className={`fixed md:relative z-50 inset-y-0 left-0 w-72 bg-zinc-900/50 backdrop-blur-xl border-r border-zinc-800 flex flex-col transition-transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-4 flex flex-col gap-4">
          <button onClick={() => createNewSession()} className="bg-zinc-100 text-zinc-950 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-xl transition-all"><Plus size={18} /> New Chat</button>
          <div className="p-3 bg-zinc-800/30 rounded-2xl border border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${connectionHealth === 'perfect' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="text-[10px] uppercase font-bold text-zinc-500">{apiStatusText}</span>
            </div>
            <button onClick={() => setIsSettingsOpen(true)} className="text-zinc-500"><Settings size={14} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {sessions.map(s => (
            <div key={s.id} onClick={() => { setActiveSessionId(s.id); if(window.innerWidth < 768) setIsSidebarOpen(false); }} className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer ${activeSessionId === s.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-800/40'}`}>
              <MessageSquare size={16} />
              <div className="flex-1 truncate text-sm">{s.title || 'Untitled Chat'}</div>
              <button onClick={(e) => handleDeleteSession(e, s.id)} className="opacity-0 group-hover:opacity-100 hover:text-red-400"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-zinc-800/20 border border-zinc-800/50">
            <img src={userProfile.picture} className="w-10 h-10 rounded-full border border-zinc-700" alt="" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate flex items-center gap-1">{userProfile.name} {isUserAdmin && <ShieldAlert size={12} className="text-amber-400" />} {isUserDebi && <Heart size={12} className="text-pink-500 fill-pink-500" />}</div>
            </div>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="text-zinc-600 hover:text-red-400"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative pt-14 md:pt-0">
        <div className="md:hidden absolute top-0 inset-x-0 h-14 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 z-40 flex items-center px-4">
          <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-zinc-400"><Menu size={20} /></button>
          <span className="flex-1 text-center font-bold text-sm">Utsho AI</span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-8">
          <div className="max-w-3xl mx-auto space-y-4 pb-10">
            {(!activeSession || activeSession.messages.length === 0) ? (
              <div className="h-[60vh] flex flex-col items-center justify-center space-y-6 text-center animate-in fade-in zoom-in duration-700">
                <div className={`w-24 h-24 rounded-3xl flex items-center justify-center shadow-2xl floating-ai ${isUserDebi ? 'bg-pink-600' : 'bg-indigo-600'}`}>
                  <Sparkles size={40} className="text-white" />
                </div>
                <h2 className="text-4xl font-black mb-2">Hey {userProfile.name.split(' ')[0]}</h2>
              </div>
            ) : (
              activeSession.messages.map(m => (
                <div key={m.id} className={`flex gap-4 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-in slide-in-from-bottom-2 duration-300`}>
                   <div className={`flex flex-col gap-1.5 max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`p-4 rounded-2xl text-[16px] whitespace-pre-wrap bangla-text shadow-sm ${m.role === 'user' ? (isUserDebi ? 'bg-pink-600' : 'bg-indigo-600') + ' text-white rounded-tr-none' : 'bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-none'}`}>
                        {m.content}
                        {m.content?.startsWith('⚠️') && <div className="mt-2 text-[10px] opacity-70"><button onClick={() => setIsSettingsOpen(true)} className="underline">Add Personal Key</button></div>}
                      </div>
                   </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="p-4 md:p-8 bg-zinc-950/80 backdrop-blur-md">
          <div className="max-w-3xl mx-auto">
            <div className="relative bg-zinc-900 rounded-[2rem] border border-zinc-800 p-1.5 flex items-end gap-2 shadow-2xl">
              <textarea rows={1} value={inputText} onChange={e => { setInputText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder="Type your message..." className="flex-1 bg-transparent text-zinc-100 py-3 pl-5 pr-2 focus:outline-none resize-none max-h-40" />
              <button onClick={handleSendMessage} disabled={!inputText.trim() || isLoading} className={`p-3 rounded-full ${inputText.trim() && !isLoading ? (isUserDebi ? 'bg-pink-600' : 'bg-indigo-600') : 'bg-zinc-800 text-zinc-600'}`}><Send size={20} /></button>
            </div>
            <footer className="pt-4 flex justify-center gap-8 opacity-40 hover:opacity-100 transition-all">
               <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Admin: Shakkhor Paul</div>
               <div className="flex gap-4">
                  <a href="https://www.facebook.com/shakkhor12102005" target="_blank" className="text-zinc-500"><Facebook size={16} /></a>
                  <a href="https://www.instagram.com/shakkhor_paul/" target="_blank" className="text-zinc-500"><Instagram size={16} /></a>
               </div>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
