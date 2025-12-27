
import React, { useState, useEffect, useRef } from 'react';
import { Send, Plus, MessageSquare, Trash2, Menu, X, Sparkles, LogOut, Facebook, ShieldCheck, Zap, Globe, RefreshCcw, Settings, Key, ExternalLink, Mail, CheckCircle2, ArrowRight } from 'lucide-react';
import { ChatSession, Message, UserProfile, Gender } from './types';
import { streamChatResponse, checkApiHealth, fetchFreshKey } from './services/geminiService';

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
  
  const [onboardingStep, setOnboardingStep] = useState<1 | 2 | 3>(1);
  const [onboardingEmail, setOnboardingEmail] = useState('');
  const [onboardingName, setOnboardingName] = useState('');
  const [onboardingGender, setOnboardingGender] = useState<Gender | null>(null);
  const [customKeyInput, setCustomKeyInput] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bootApp = async () => {
      setApiStatusText('Booting...');
      await fetchFreshKey();

      const savedProfile = localStorage.getItem('utsho_profile');
      if (savedProfile) {
        const profile = JSON.parse(savedProfile);
        setUserProfile(profile);
        setCustomKeyInput(profile.customApiKey || '');
        await performHealthCheck(profile.customApiKey);
      }

      const saved = localStorage.getItem('chat_sessions');
      if (saved) {
        const parsed = JSON.parse(saved);
        const formatted = parsed.map((s: any) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          messages: s.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
        }));
        setSessions(formatted);
        if (formatted.length > 0) setActiveSessionId(formatted[0].id);
      } else if (savedProfile) {
        createNewSession();
      }
    };

    bootApp();
  }, []);

  const finalizeOnboarding = () => {
    if (!onboardingName || !onboardingEmail || !onboardingGender) return;
    const profile: UserProfile = {
      name: onboardingName,
      email: onboardingEmail,
      gender: onboardingGender,
      picture: `https://ui-avatars.com/api/?name=${onboardingName}&background=${onboardingGender === 'male' ? '4f46e5' : 'db2777'}&color=fff`,
      customApiKey: ''
    };
    setUserProfile(profile);
    localStorage.setItem('utsho_profile', JSON.stringify(profile));
    createNewSession();
    performHealthCheck();
  };

  const performHealthCheck = async (key?: string) => {
    setApiStatusText('Checking Nodes...');
    const isHealthy = await checkApiHealth(key);
    if (isHealthy) {
      setConnectionHealth('perfect');
      setApiStatusText(key ? 'Personal Key Active' : 'Smart Pool Active');
    } else {
      setConnectionHealth('error');
      setApiStatusText('Pool Exhausted');
    }
  };

  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('chat_sessions', JSON.stringify(sessions));
    }
  }, [sessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId, isLoading]);

  const saveSettings = async () => {
    if (!userProfile) return;
    const updatedProfile = { ...userProfile, customApiKey: customKeyInput.trim() };
    setUserProfile(updatedProfile);
    localStorage.setItem('utsho_profile', JSON.stringify(updatedProfile));
    setIsSettingsOpen(false);
    await performHealthCheck(updatedProfile.customApiKey);
  };

  const createNewSession = () => {
    const newId = crypto.randomUUID();
    const newSession: ChatSession = {
      id: newId,
      title: 'নতুন চ্যাট',
      messages: [],
      createdAt: new Date(),
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading || !activeSessionId || !userProfile) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: inputText,
      timestamp: new Date(),
    };

    const currentInput = inputText;
    setInputText('');
    setIsLoading(true);

    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        const updatedMessages = [...s.messages, userMessage];
        const newTitle = s.messages.length === 0 ? currentInput.slice(0, 30) + (currentInput.length > 30 ? '...' : '') : s.title;
        return { ...s, messages: updatedMessages, title: newTitle };
      }
      return s;
    }));

    const aiMessageId = crypto.randomUUID();
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, messages: [...s.messages, { id: aiMessageId, role: 'model', content: '', timestamp: new Date() }] };
      }
      return s;
    }));

    await streamChatResponse(
      [...(sessions.find(s => s.id === activeSessionId)?.messages || []), userMessage],
      userProfile,
      (chunk) => {
        setSessions(prev => prev.map(s => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: s.messages.map(m => m.id === aiMessageId ? { ...m, content: m.content + chunk } : m)
            };
          }
          return s;
        }));
      },
      () => {
        setIsLoading(false);
        setApiStatusText(userProfile.customApiKey ? 'Personal Key Active' : 'Shared Pool Active');
      },
      (error) => {
        setIsLoading(false);
        setConnectionHealth('error');
        setSessions(prev => prev.map(s => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: s.messages.map(m => m.id === aiMessageId ? { ...m, content: `⚠️ ${error.message}` } : m)
            };
          }
          return s;
        }));
      },
      (status) => setApiStatusText(status)
    );
  };

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Sparkles size={120} />
          </div>

          <div className="relative z-10">
            <div className="flex justify-center mb-8">
              <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl floating-ai">
                <Sparkles size={32} />
              </div>
            </div>

            {onboardingStep === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <div className="text-center space-y-2">
                  <h1 className="text-3xl font-bold tracking-tight">Utsho AI</h1>
                  <p className="text-zinc-500 text-sm">Welcome back. Enter your email to begin.</p>
                </div>
                <div className="space-y-4">
                  <div className="relative group">
                    <Mail className="absolute left-4 top-4 text-zinc-500 group-focus-within:text-indigo-400 transition-colors" size={20} />
                    <input 
                      type="email" 
                      placeholder="Gmail Address" 
                      value={onboardingEmail}
                      onChange={e => setOnboardingEmail(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                    />
                  </div>
                  <button 
                    onClick={() => setOnboardingStep(2)}
                    disabled={!onboardingEmail.includes('@')}
                    className="w-full bg-zinc-100 text-zinc-950 font-bold py-4 rounded-2xl hover:bg-white transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    Next Step <ArrowRight size={18} />
                  </button>
                </div>
              </div>
            )}

            {onboardingStep === 2 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <div className="text-center space-y-2">
                  <h1 className="text-2xl font-bold">What's your name?</h1>
                  <p className="text-zinc-500 text-sm">Let Utsho AI know how to address you.</p>
                </div>
                <div className="space-y-4">
                  <input 
                    type="text" 
                    placeholder="Full Name" 
                    autoFocus
                    value={onboardingName}
                    onChange={e => setOnboardingName(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-2xl py-4 px-6 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-center text-lg"
                  />
                  <button 
                    onClick={() => setOnboardingStep(3)}
                    disabled={onboardingName.length < 2}
                    className="w-full bg-zinc-100 text-zinc-950 font-bold py-4 rounded-2xl hover:bg-white transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    Continue <ArrowRight size={18} />
                  </button>
                  <button onClick={() => setOnboardingStep(1)} className="w-full text-zinc-500 text-xs font-bold uppercase tracking-widest hover:text-white transition-colors">Go Back</button>
                </div>
              </div>
            )}

            {onboardingStep === 3 && (
              <div className="space-y-8 animate-in fade-in slide-in-from-right-4 text-center">
                <div className="space-y-2">
                  <h1 className="text-2xl font-bold">Pick Personality</h1>
                  <p className="text-zinc-500 text-sm">Choose how Utsho AI should talk to you.</p>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => setOnboardingGender('male')} className={`flex flex-col items-center gap-3 p-6 rounded-3xl border-2 transition-all group ${onboardingGender === 'male' ? 'bg-indigo-500/10 border-indigo-500' : 'bg-zinc-800 border-transparent text-zinc-500 hover:bg-zinc-800/80'}`}>
                    <span className="text-4xl group-hover:scale-110 transition-transform">👦</span>
                    <span className="text-xs font-bold uppercase tracking-[0.2em]">Bro Mode</span>
                  </button>
                  <button onClick={() => setOnboardingGender('female')} className={`flex flex-col items-center gap-3 p-6 rounded-3xl border-2 transition-all group ${onboardingGender === 'female' ? 'bg-pink-500/10 border-pink-500' : 'bg-zinc-800 border-transparent text-zinc-500 hover:bg-zinc-800/80'}`}>
                    <span className="text-4xl group-hover:scale-110 transition-transform">👧</span>
                    <span className="text-xs font-bold uppercase tracking-[0.2em]">Sweet Mode</span>
                  </button>
                </div>

                <div className="space-y-4 pt-4">
                  <button 
                    onClick={finalizeOnboarding}
                    disabled={!onboardingGender}
                    className="w-full bg-zinc-100 text-zinc-950 font-bold py-4 rounded-2xl hover:bg-white transition-all shadow-xl disabled:opacity-50"
                  >
                    Start Chatting
                  </button>
                  <button onClick={() => setOnboardingStep(2)} className="text-zinc-500 text-xs font-bold uppercase tracking-widest hover:text-white transition-colors">Change Name</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const activeSession = sessions.find(s => s.id === activeSessionId);

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-['Hind_Siliguri',_sans-serif]">
      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setIsSettingsOpen(false)} />
          <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl space-y-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold flex items-center gap-2"><Key size={20} className="text-indigo-400" /> Advanced Settings</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-zinc-800 rounded-full transition-colors"><X size={20} /></button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Optional Personal Key</label>
                <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-[10px] flex items-center gap-1 text-indigo-400 font-bold uppercase">Get Key <ExternalLink size={10} /></a>
              </div>
              <input 
                type="password" 
                value={customKeyInput}
                onChange={(e) => setCustomKeyInput(e.target.value)}
                placeholder="Paste your own AIza... key here"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono"
              />
              <p className="text-[10px] text-zinc-500 italic">ব্যক্তিগত Key থাকলে শেয়ারড পুলের সীমা নিয়ে চিন্তা করতে হবে না।</p>
            </div>

            <div className="flex gap-4">
              <button onClick={() => setCustomKeyInput('')} className="flex-1 py-3 text-sm font-bold text-zinc-500 hover:text-white transition-colors">Clear</button>
              <button onClick={saveSettings} className="flex-1 py-3 text-sm font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 transition-all shadow-lg active:scale-95">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-zinc-900/90 backdrop-blur-xl border-b border-zinc-800 z-40 flex items-center justify-between px-4">
        <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-zinc-800 rounded-lg"><Menu size={20} /></button>
        <div className="flex flex-col items-center">
          <span className="font-bold text-xs flex items-center gap-1"><Sparkles size={14} className="text-indigo-400" /> Utsho AI</span>
          <span className="text-[8px] text-zinc-500 uppercase tracking-widest flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${connectionHealth === 'perfect' ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500'}`} /> {apiStatusText}
          </span>
        </div>
        <button onClick={() => setIsSettingsOpen(true)} className="p-1">
           <img src={userProfile.picture} className="w-8 h-8 rounded-full border border-zinc-700" />
        </button>
      </div>

      <aside className={`fixed md:relative z-50 inset-y-0 left-0 w-72 bg-zinc-900/50 backdrop-blur-xl border-r border-zinc-800 flex flex-col transition-transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-4 flex flex-col gap-4">
          <button onClick={createNewSession} className="flex items-center justify-center gap-2 bg-zinc-100 text-zinc-950 py-3.5 rounded-2xl font-bold hover:bg-white transition-all shadow-xl active:scale-95"><Plus size={18} /> New Conversation</button>
          
          <div className="p-3 bg-zinc-800/30 rounded-2xl border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {userProfile.customApiKey ? <ShieldCheck size={14} className="text-indigo-400" /> : <Globe size={14} className="text-emerald-500" />}
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                  {userProfile.customApiKey ? 'Personal Mode' : 'Smart Shared Pool'}
                </span>
              </div>
              <button onClick={() => setIsSettingsOpen(true)} className="text-zinc-500 hover:text-white"><Settings size={12} /></button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${connectionHealth === 'perfect' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-[9px] text-zinc-500 truncate font-bold uppercase tracking-tight">{apiStatusText}</span>
              </div>
              <button onClick={() => performHealthCheck(userProfile.customApiKey)} className="text-zinc-600 hover:text-zinc-300"><RefreshCcw size={10} /></button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {sessions.map((s) => (
            <div key={s.id} onClick={() => { setActiveSessionId(s.id); if (window.innerWidth < 768) setIsSidebarOpen(false); }} className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all ${activeSessionId === s.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-800/40'}`}>
              <MessageSquare size={16} className={activeSessionId === s.id ? 'text-indigo-400' : ''} />
              <div className="flex-1 truncate text-sm">{s.title}</div>
              <button onClick={(e) => { e.stopPropagation(); setSessions(prev => prev.filter(x => x.id !== s.id)); }} className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800 mt-auto">
          <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-zinc-800/20 border border-zinc-800/50">
            <img src={userProfile.picture} className="w-10 h-10 rounded-full border border-zinc-700 shadow-md" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate">{userProfile.name}</div>
              <div className={`text-[9px] font-bold uppercase flex items-center gap-1 ${userProfile.gender === 'male' ? 'text-indigo-400' : 'text-pink-400'}`}>
                {userProfile.gender === 'male' ? 'Bro Mode' : 'Sweet Mode'}
                <CheckCircle2 size={8} />
              </div>
            </div>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="p-2 text-zinc-600 hover:text-red-400 transition-colors"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col pt-14 md:pt-0 overflow-hidden relative">
        <div className="flex-1 overflow-y-auto px-4 py-8 relative">
          <div className="max-w-3xl mx-auto space-y-8">
            {activeSession?.messages.length === 0 ? (
              <div className="h-[70vh] flex flex-col items-center justify-center text-center space-y-10 animate-in fade-in zoom-in duration-1000">
                <div className="relative group">
                  <div className={`absolute -inset-8 blur-3xl opacity-20 group-hover:opacity-40 transition-opacity rounded-full ${userProfile.gender === 'male' ? 'bg-indigo-500' : 'bg-pink-500'}`} />
                  <div className={`w-28 h-28 rounded-[2.5rem] flex items-center justify-center relative shadow-2xl transition-transform hover:scale-110 duration-500 ${userProfile.gender === 'male' ? 'bg-indigo-600 text-white' : 'bg-pink-600 text-white'}`}>
                    <Sparkles size={52} />
                  </div>
                </div>
                <div className="space-y-4">
                  <h2 className="text-4xl md:text-5xl font-black tracking-tight bangla-text bg-clip-text text-transparent bg-gradient-to-b from-white to-zinc-500">স্বাগতম, {userProfile.name.split(' ')[0]}!</h2>
                  <p className="text-zinc-500 text-sm md:text-base max-w-sm mx-auto bangla-text leading-relaxed">
                    আমি উৎস AI, আপনার সব প্রশ্নের উত্তর দিতে প্রস্তুত।
                  </p>
                </div>
              </div>
            ) : (
              activeSession?.messages.map((m) => (
                <div key={m.id} className={`flex gap-3 md:gap-4 w-full ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-in slide-in-from-bottom-2 duration-300`}>
                  <div className="flex-shrink-0 mt-1">
                    {m.role === 'model' ? (
                      <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-sm">
                        <Sparkles size={14} className="text-indigo-400" />
                      </div>
                    ) : (
                      <img src={userProfile.picture} className="w-8 h-8 rounded-full border border-zinc-800 shadow-sm" />
                    )}
                  </div>
                  
                  <div className={`flex flex-col gap-1.5 max-w-[82%] sm:max-w-[75%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`p-4 rounded-2xl text-[15px] md:text-[16px] whitespace-pre-wrap break-words overflow-hidden bangla-text shadow-sm ${
                      m.role === 'user' 
                        ? (userProfile.gender === 'male' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-pink-600 text-white rounded-tr-none') 
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-none'
                    }`}>
                      {m.content || (isLoading && m.role === 'model' ? (
                        <div className="flex items-center gap-1.5 py-1 px-1">
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-duration:0.6s]"></div>
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.2s] [animation-duration:0.6s]"></div>
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.4s] [animation-duration:0.6s]"></div>
                        </div>
                      ) : null)}
                    </div>
                    <span className="text-[10px] text-zinc-600 font-medium px-1">
                      {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>

        <div className="p-4 md:p-8 bg-zinc-950/80 backdrop-blur-md border-t border-zinc-900/50">
          <div className="max-w-3xl mx-auto relative group">
            <div className={`absolute -inset-1 blur-2xl opacity-10 group-focus-within:opacity-25 transition-opacity duration-700 ${userProfile.gender === 'male' ? 'bg-indigo-500' : 'bg-pink-500'}`} />
            <div className="relative bg-zinc-900 rounded-[2rem] border border-zinc-800 p-1.5 flex items-end gap-2 shadow-2xl">
              <textarea
                rows={1}
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }}
                onKeyDown={(e) => { 
                  if (e.key === 'Enter' && !e.shiftKey) { 
                    e.preventDefault(); 
                    handleSendMessage(); 
                    e.currentTarget.style.height = 'auto';
                  } 
                }}
                placeholder="এখানে কিছু লিখুন..."
                className="flex-1 bg-transparent text-zinc-100 py-3 pl-5 pr-2 focus:outline-none transition-all resize-none max-h-[120px] bangla-text"
                style={{ height: 'auto' }}
              />
              <button
                onClick={() => { handleSendMessage(); if (messagesEndRef.current) messagesEndRef.current.scrollIntoView(); }}
                disabled={!inputText.trim() || isLoading}
                className={`p-3 rounded-full transition-all shrink-0 active:scale-90 ${inputText.trim() && !isLoading ? (userProfile.gender === 'male' ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'bg-pink-600 text-white hover:bg-pink-500') : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'}`}
              >
                <Send size={20} />
              </button>
            </div>
            
            <div className="flex justify-center gap-8 mt-6 opacity-40 hover:opacity-100 transition-all duration-500">
               <button onClick={() => setIsSettingsOpen(true)} className="text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em] flex items-center gap-1.5 hover:text-indigo-400 transition-colors"><Zap size={10} /> Sync Pool</button>
               <a href="https://www.facebook.com/shakkhor12102005/" target="_blank" className="text-[9px] text-zinc-500 flex items-center gap-1.5 hover:text-indigo-400 font-bold uppercase tracking-[0.2em] transition-colors"><Facebook size={10} /> Shakkhor Paul</a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
