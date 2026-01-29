
import React, { useState, useEffect, useRef } from 'react';
import { Send, Plus, MessageSquare, Trash2, Menu, X, Sparkles, LogOut, Facebook, ShieldCheck, Zap, Globe, RefreshCcw, Settings, Key, ExternalLink, Mail, CheckCircle2, ArrowRight, Cloud, CloudOff, AlertTriangle, ShieldAlert, Calendar, Instagram } from 'lucide-react';
import { ChatSession, Message, UserProfile, Gender } from './types';
import { streamChatResponse, checkApiHealth, fetchFreshKey } from './services/geminiService';
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
  
  const [onboardingStep, setOnboardingStep] = useState<1 | 2 | 3 | 4>(1);
  const [onboardingEmail, setOnboardingEmail] = useState('');
  const [onboardingName, setOnboardingName] = useState('');
  const [onboardingAge, setOnboardingAge] = useState<string>('');
  const [onboardingGender, setOnboardingGender] = useState<Gender | null>(null);
  const [customKeyInput, setCustomKeyInput] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bootApp = async () => {
      setApiStatusText('Booting...');
      await fetchFreshKey();
      setDbStatus(db.isDatabaseEnabled());

      const localProfile = localStorage.getItem('utsho_profile');
      if (localProfile) {
        const profile = JSON.parse(localProfile) as UserProfile;
        setUserProfile(profile);
        setCustomKeyInput(profile.customApiKey || '');
        
        if (db.isDatabaseEnabled()) {
          setIsSyncing(true);
          try {
            const cloudProfile = await db.getUserProfile(profile.email);
            if (cloudProfile) {
              setUserProfile(cloudProfile);
              setCustomKeyInput(cloudProfile.customApiKey || '');
            }
            const cloudSessions = await db.getSessions(profile.email);
            setSessions(cloudSessions);
            if (cloudSessions.length > 0) setActiveSessionId(cloudSessions[0].id);
          } catch (e) {
            console.error("Sync error:", e);
          } finally {
            setIsSyncing(false);
          }
        }
        await performHealthCheck(profile.customApiKey);
      }
    };
    bootApp();
  }, []);

  const handleGoogleLogin = async () => {
    try {
      setIsSyncing(true);
      const profile = await db.loginWithGoogle();
      if (profile) {
        const existingCloudProfile = await db.getUserProfile(profile.email);
        if (!existingCloudProfile) {
          setOnboardingEmail(profile.email);
          setOnboardingName(profile.name);
          setOnboardingStep(2);
        } else {
          setUserProfile(existingCloudProfile);
          localStorage.setItem('utsho_profile', JSON.stringify(existingCloudProfile));
          const cloudSessions = await db.getSessions(profile.email);
          setSessions(cloudSessions);
          if (cloudSessions.length > 0) setActiveSessionId(cloudSessions[0].id);
          else createNewSession(profile.email);
          await performHealthCheck(existingCloudProfile.customApiKey);
        }
      }
    } catch (e: any) {
      alert(`Login failed: ${e.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const finalizeOnboarding = async () => {
    if (!onboardingName || !onboardingEmail || !onboardingGender || !onboardingAge) return;
    setIsSyncing(true);
    const profile: UserProfile = {
      name: onboardingName,
      email: onboardingEmail.toLowerCase().trim(),
      gender: onboardingGender,
      age: parseInt(onboardingAge) || 20,
      picture: `https://ui-avatars.com/api/?name=${onboardingName}&background=${onboardingGender === 'male' ? '4f46e5' : 'db2777'}&color=fff`,
      customApiKey: ''
    };
    
    localStorage.setItem('utsho_profile', JSON.stringify(profile));
    setUserProfile(profile);
    
    if (dbStatus) {
      await db.saveUserProfile(profile);
    }
    
    createNewSession(profile.email);
    setIsSyncing(false);
    performHealthCheck();
  };

  const performHealthCheck = async (key?: string) => {
    setApiStatusText('Checking Nodes...');
    const isHealthy = await checkApiHealth(key);
    setConnectionHealth(isHealthy ? 'perfect' : 'error');
    setApiStatusText(isHealthy ? (key ? 'Personal Active' : 'Pool Active') : 'Node Error');
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId, isLoading]);

  const saveSettings = async () => {
    if (!userProfile) return;
    setIsSyncing(true);
    const updated = { ...userProfile, customApiKey: customKeyInput.trim() };
    setUserProfile(updated);
    localStorage.setItem('utsho_profile', JSON.stringify(updated));
    if (dbStatus) await db.saveUserProfile(updated);
    setIsSyncing(false);
    setIsSettingsOpen(false);
    await performHealthCheck(updated.customApiKey);
  };

  const createNewSession = (emailOverride?: string) => {
    const email = emailOverride || userProfile?.email;
    if (!email) return;
    const newSession: ChatSession = {
      id: crypto.randomUUID(),
      title: 'New Chat',
      messages: [],
      createdAt: new Date(),
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
    if (dbStatus) db.saveSession(email, newSession);
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading || !activeSessionId || !userProfile) return;

    const currentSession = sessions.find(s => s.id === activeSessionId);
    if (!currentSession) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: inputText,
      timestamp: new Date(),
    };

    const aiMessageId = crypto.randomUUID();
    const updatedHistory = [...currentSession.messages, userMessage];
    const tempAiMessage: Message = { id: aiMessageId, role: 'model', content: '', timestamp: new Date() };

    setInputText('');
    setIsLoading(true);

    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { 
          ...s, 
          messages: [...updatedHistory, tempAiMessage],
          title: s.messages.length === 0 ? userMessage.content.slice(0, 25) : s.title 
        };
      }
      return s;
    }));

    await streamChatResponse(
      updatedHistory,
      userProfile,
      (chunk) => {
        setSessions(prev => prev.map(s => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: (s.messages || []).map(m => m.id === aiMessageId ? { ...m, content: (m.content || '') + chunk } : m)
            };
          }
          return s;
        }));
      },
      (fullText) => {
        setIsLoading(false);
        if (dbStatus) {
          const finalMessages = [...updatedHistory, { ...tempAiMessage, content: fullText }];
          db.updateSessionMessages(userProfile.email, activeSessionId, finalMessages);
        }
      },
      (error) => {
        setIsLoading(false);
        setConnectionHealth('error');
        setSessions(prev => prev.map(s => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: (s.messages || []).map(m => m.id === aiMessageId ? { ...m, content: `⚠️ Error: ${error.message || 'Unknown technical issue'}` } : m)
            };
          }
          return s;
        }));
      },
      (status) => setApiStatusText(status)
    );
  };

  if (!userProfile || (onboardingStep > 1 && onboardingStep < 4)) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-10 shadow-2xl space-y-8">
          {onboardingStep === 1 ? (
            <div className="text-center space-y-6">
              <div className="flex justify-center"><div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white floating-ai"><Sparkles size={32} /></div></div>
              <h1 className="text-3xl font-bold">Utsho AI</h1>
              <p className="text-zinc-500 text-sm">Welcome back. Sign in to sync your chats.</p>
              <button onClick={handleGoogleLogin} className="w-full bg-white text-zinc-950 font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-zinc-100 transition-all">
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="" />
                Sign in with Google
              </button>
            </div>
          ) : onboardingStep === 2 ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <h2 className="text-2xl font-bold text-center">Confirm Identity</h2>
              <div className="space-y-4">
                <input type="text" value={onboardingName} onChange={e => setOnboardingName(e.target.value)} placeholder="Full Name" className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl py-4 px-6 focus:ring-2 focus:ring-indigo-500 outline-none" />
                <div className="relative">
                  <Calendar className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                  <input type="number" value={onboardingAge} onChange={e => setOnboardingAge(e.target.value)} placeholder="Age" className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl py-4 pl-14 pr-6 focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <button onClick={() => setOnboardingStep(3)} disabled={!onboardingName || !onboardingAge} className="w-full bg-indigo-600 py-4 rounded-2xl font-bold hover:bg-indigo-500 transition-all disabled:opacity-50">Next</button>
              </div>
            </div>
          ) : (
            <div className="space-y-8 text-center animate-in fade-in slide-in-from-right-4">
              <h2 className="text-2xl font-bold">Pick Personality</h2>
              <p className="text-zinc-500 text-sm">How should Utsho address you?</p>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => setOnboardingGender('male')} className={`p-6 rounded-3xl border-2 transition-all ${onboardingGender === 'male' ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-800 bg-zinc-800/50'}`}>
                  <span className="text-4xl block mb-2">👦</span> Male
                </button>
                <button onClick={() => setOnboardingGender('female')} className={`p-6 rounded-3xl border-2 transition-all ${onboardingGender === 'female' ? 'border-pink-500 bg-pink-500/10' : 'border-zinc-800 bg-zinc-800/50'}`}>
                  <span className="text-4xl block mb-2">👧</span> Female
                </button>
              </div>
              <button onClick={finalizeOnboarding} disabled={!onboardingGender} className="w-full bg-white text-zinc-950 font-bold py-4 rounded-2xl shadow-xl disabled:opacity-50">Start Chatting</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const isUserAdmin = db.isAdmin(userProfile.email);

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-['Hind_Siliguri',_sans-serif]">
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 space-y-6">
            <h3 className="text-xl font-bold flex items-center gap-2"><Settings size={20} /> Settings</h3>
            <div className="space-y-4">
              <label className="text-xs text-zinc-500 uppercase font-bold tracking-widest">Personal Gemini Key</label>
              <input type="password" value={customKeyInput} onChange={e => setCustomKeyInput(e.target.value)} placeholder="AIza..." className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm outline-none font-mono" />
            </div>
            <div className="flex gap-4">
              <button onClick={() => setIsSettingsOpen(false)} className="flex-1 py-3 font-bold text-zinc-500">Cancel</button>
              <button onClick={saveSettings} className="flex-1 py-3 font-bold bg-indigo-600 rounded-xl">Save</button>
            </div>
          </div>
        </div>
      )}

      <aside className={`fixed md:relative z-50 inset-y-0 left-0 w-72 bg-zinc-900/50 backdrop-blur-xl border-r border-zinc-800 flex flex-col transition-transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-4 flex flex-col gap-4">
          <button onClick={() => createNewSession()} className="bg-zinc-100 text-zinc-950 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-xl active:scale-95 transition-all"><Plus size={18} /> New Chat</button>
          <div className="p-3 bg-zinc-800/30 rounded-2xl border border-zinc-800 space-y-3">
             <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">{userProfile.customApiKey ? 'Personal Mode' : 'Smart Shared Pool'}</span>
                <button onClick={() => setIsSettingsOpen(true)} className="text-zinc-500 hover:text-white"><Settings size={14} /></button>
             </div>
             <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${connectionHealth === 'perfect' ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500'}`} />
                <span className="text-[10px] uppercase font-bold text-zinc-500">{apiStatusText}</span>
             </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {sessions.map(s => (
            <div key={s.id} onClick={() => { setActiveSessionId(s.id); if(window.innerWidth < 768) setIsSidebarOpen(false); }} className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all ${activeSessionId === s.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-800/40'}`}>
              <MessageSquare size={16} className={activeSessionId === s.id ? 'text-indigo-400' : ''} />
              <div className="flex-1 truncate text-sm">{s.title || 'Conversation'}</div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-zinc-800/20 border border-zinc-800/50">
            <img src={userProfile.picture} className="w-10 h-10 rounded-full border border-zinc-700 shadow-lg" alt="" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate flex items-center gap-1">{userProfile.name} {isUserAdmin && <ShieldAlert size={12} className="text-amber-400" />}</div>
              <div className="text-[9px] uppercase font-bold text-zinc-500 flex items-center gap-1">
                {userProfile.age}Y • {userProfile.gender === 'male' ? (userProfile.age >= 50 ? 'Respect' : (userProfile.age >= 30 ? 'Senior' : 'Bro')) : (userProfile.age >= 50 ? 'Mother' : (userProfile.age >= 30 ? 'Lady' : 'Charm'))}
                <CheckCircle2 size={8} className="text-indigo-400" />
              </div>
            </div>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="p-2 text-zinc-600 hover:text-red-400"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative pt-14 md:pt-0">
        <div className="md:hidden absolute top-0 inset-x-0 h-14 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 z-40 flex items-center px-4">
          <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-zinc-400"><Menu size={20} /></button>
          <span className="flex-1 text-center font-bold text-sm tracking-tight flex items-center justify-center gap-1"><Sparkles size={14} className="text-indigo-500" /> Utsho AI</span>
          <div className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-8">
          <div className="max-w-3xl mx-auto space-y-8">
            {(activeSession?.messages || []).length === 0 ? (
              <div className="h-[60vh] flex flex-col items-center justify-center space-y-6 text-center animate-in fade-in zoom-in duration-700">
                <div className={`w-24 h-24 rounded-3xl flex items-center justify-center shadow-2xl floating-ai ${userProfile.gender === 'male' ? 'bg-indigo-600' : 'bg-pink-600'}`}>
                  <Sparkles size={40} className="text-white" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-4xl font-black mb-2">Hello, {userProfile.name.split(' ')[0]}</h2>
                  <p className="text-zinc-500 max-w-sm mx-auto">I'm Utsho, your AI assistant. Ready to help you with anything from code to simple chats!</p>
                </div>
              </div>
            ) : (
              (activeSession?.messages || []).map(m => (
                <div key={m.id} className={`flex gap-4 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-in slide-in-from-bottom-2`}>
                   <div className={`flex flex-col gap-1.5 max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`p-4 rounded-2xl text-[16px] whitespace-pre-wrap bangla-text shadow-sm ${m.role === 'user' ? (userProfile.gender === 'male' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-pink-600 text-white rounded-tr-none') : 'bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-none'}`}>
                        {m.content || (isLoading && m.role === 'model' ? <span className="flex gap-1 items-center"><span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"></span><span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.2s]"></span><span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.4s]"></span></span> : '')}
                      </div>
                      <span className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest">{new Date(m.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                   </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="p-4 md:p-8 bg-zinc-950/80 backdrop-blur-md border-t border-zinc-900/50">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-[2.2rem] blur opacity-10 group-focus-within:opacity-20 transition duration-1000"></div>
              <div className="relative bg-zinc-900 rounded-[2rem] border border-zinc-800 p-1.5 flex items-end gap-2 shadow-2xl">
                <textarea rows={1} value={inputText} onChange={e => { setInputText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder="Type your message..." className="flex-1 bg-transparent text-zinc-100 py-3 pl-5 pr-2 focus:outline-none transition-all resize-none max-h-40" />
                <button onClick={handleSendMessage} disabled={!inputText.trim() || isLoading} className={`p-3 rounded-full transition-all active:scale-90 shadow-lg ${inputText.trim() && !isLoading ? (userProfile.gender === 'male' ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'bg-pink-600 text-white hover:bg-pink-500') : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'}`}><Send size={20} /></button>
              </div>
            </div>

            {/* Admin/Developer Footer */}
            <footer className="pt-2 flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8 opacity-40 hover:opacity-100 transition-all duration-500">
               <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                  <Zap size={12} className="text-amber-500" /> Lead Developer: Shakkhor Paul
               </div>
               <div className="flex items-center gap-6">
                  <a href="https://www.facebook.com/shakkhor12102005" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-indigo-500 transition-colors" title="Facebook">
                    <Facebook size={18} />
                  </a>
                  <a href="https://www.instagram.com/shakkhor_paul/" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-pink-500 transition-colors" title="Instagram">
                    <Instagram size={18} />
                  </a>
                  <a href="mailto:shakkhorpaul50@gmail.com" className="text-zinc-500 hover:text-indigo-400 transition-colors" title="Email">
                    <Mail size={18} />
                  </a>
               </div>
               <div className="hidden md:block text-[9px] text-zinc-700 font-bold uppercase tracking-widest">
                  © {new Date().getFullYear()} Utsho Digital
               </div>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
