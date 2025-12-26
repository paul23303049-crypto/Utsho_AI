
import React, { useState, useEffect, useRef } from 'react';
import { Send, Plus, MessageSquare, Trash2, Menu, X, Sparkles, LogOut, Facebook, ShieldCheck, Zap, Globe, RefreshCcw } from 'lucide-react';
import { ChatSession, Message, UserProfile, Gender } from './types';
import { streamChatResponse } from './services/geminiService';

const App: React.FC = () => {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [apiStatusText, setApiStatusText] = useState<string>('Ready');
  const [connectionHealth, setConnectionHealth] = useState<'perfect' | 'warning' | 'error'>('perfect');

  // Onboarding States
  const [onboardingName, setOnboardingName] = useState('');
  const [onboardingGender, setOnboardingGender] = useState<Gender | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedProfile = localStorage.getItem('utsho_profile');
    if (savedProfile) setUserProfile(JSON.parse(savedProfile));

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
  }, []);

  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('chat_sessions', JSON.stringify(sessions));
    }
  }, [sessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId, isLoading]);

  const handleOnboarding = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onboardingName.trim() || !onboardingGender) return;
    const profile: UserProfile = { name: onboardingName, gender: onboardingGender };
    setUserProfile(profile);
    localStorage.setItem('utsho_profile', JSON.stringify(profile));
    createNewSession();
  };

  const createNewSession = () => {
    const newId = crypto.randomUUID();
    const newSession: ChatSession = {
      id: newId,
      title: 'নতুন কথোপকথন',
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
    setConnectionHealth('perfect');

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
        setApiStatusText('Active');
      },
      (error) => {
        setIsLoading(false);
        setConnectionHealth('error');
        setApiStatusText('Connection Failed');
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
      (status) => {
        setApiStatusText(status);
        if (status.includes('unstable')) setConnectionHealth('warning');
      }
    );
  };

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-indigo-500 rounded-2xl flex items-center justify-center text-white shadow-lg">
              <Sparkles size={32} />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center mb-2">Welcome to Utsho AI</h1>
          <form onSubmit={handleOnboarding} className="space-y-6 mt-8">
            <input 
              type="text" 
              value={onboardingName}
              onChange={(e) => setOnboardingName(e.target.value)}
              placeholder="আপনার নাম লিখুন"
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-center"
            />
            <div className="grid grid-cols-2 gap-4">
              <button type="button" onClick={() => setOnboardingGender('male')} className={`py-3 rounded-xl border transition-all ${onboardingGender === 'male' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>Male</button>
              <button type="button" onClick={() => setOnboardingGender('female')} className={`py-3 rounded-xl border transition-all ${onboardingGender === 'female' ? 'bg-pink-600 border-pink-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>Female</button>
            </div>
            <button type="submit" disabled={!onboardingName || !onboardingGender} className="w-full bg-zinc-100 text-zinc-950 font-bold py-4 rounded-xl hover:bg-white transition-all disabled:opacity-50">Start Chatting</button>
          </form>
        </div>
      </div>
    );
  }

  const activeSession = sessions.find(s => s.id === activeSessionId);

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-['Hind_Siliguri',_sans-serif]">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-zinc-900/90 backdrop-blur-xl border-b border-zinc-800 z-40 flex items-center justify-between px-4">
        <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-zinc-800 rounded-lg"><Menu size={20} /></button>
        <div className="flex flex-col items-center">
          <span className="font-bold text-xs flex items-center gap-1"><Sparkles size={14} className="text-indigo-400" /> Utsho AI</span>
          <span className="text-[8px] text-zinc-500 uppercase tracking-widest flex items-center gap-1">
            <div className={`w-1 h-1 rounded-full ${connectionHealth === 'perfect' ? 'bg-emerald-500' : connectionHealth === 'warning' ? 'bg-amber-500' : 'bg-red-500'}`} /> {apiStatusText}
          </span>
        </div>
        <button onClick={createNewSession} className="p-2 hover:bg-zinc-800 rounded-lg"><Plus size={20} /></button>
      </div>

      {isSidebarOpen && <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 md:hidden" onClick={() => setIsSidebarOpen(false)} />}

      <aside className={`fixed md:relative z-50 inset-y-0 left-0 w-72 bg-zinc-900/50 backdrop-blur-xl border-r border-zinc-800 flex flex-col transition-transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-4 flex flex-col gap-4">
          <button onClick={createNewSession} className="flex items-center justify-center gap-2 bg-zinc-100 text-zinc-950 py-2.5 rounded-xl font-bold hover:bg-white transition-all shadow-lg"><Plus size={18} /> New Chat</button>
          
          <div className={`flex flex-col gap-2 p-3 rounded-xl border transition-all ${connectionHealth === 'perfect' ? 'bg-emerald-500/5 border-emerald-500/10' : connectionHealth === 'warning' ? 'bg-amber-500/5 border-amber-500/10' : 'bg-red-500/5 border-red-500/10'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Shared API Pool</span>
              <RefreshCcw size={10} className={`text-zinc-500 ${isLoading ? 'animate-spin' : ''}`} />
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${connectionHealth === 'perfect' ? 'bg-emerald-500' : connectionHealth === 'warning' ? 'bg-amber-500' : 'bg-red-500'} shadow-[0_0_8px_currentColor]`} />
              <span className={`text-[11px] font-bold ${connectionHealth === 'perfect' ? 'text-emerald-400' : connectionHealth === 'warning' ? 'text-amber-400' : 'text-red-400'}`}>
                {apiStatusText}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {sessions.map((s) => (
            <div key={s.id} onClick={() => { setActiveSessionId(s.id); if (window.innerWidth < 768) setIsSidebarOpen(false); }} className={`group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${activeSessionId === s.id ? 'bg-zinc-800/80 text-zinc-100 ring-1 ring-zinc-700' : 'text-zinc-500 hover:bg-zinc-800/40'}`}>
              <MessageSquare size={16} />
              <div className="flex-1 truncate text-sm">{s.title}</div>
              <button onClick={(e) => { e.stopPropagation(); setSessions(prev => prev.filter(x => x.id !== s.id)); }} className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-3 p-2 rounded-xl">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-lg ${userProfile.gender === 'male' ? 'bg-indigo-600' : 'bg-pink-600'}`}>{userProfile.name[0].toUpperCase()}</div>
            <div className="flex-1 min-w-0"><div className="text-sm font-bold truncate">{userProfile.name}</div><div className="text-[10px] text-zinc-500 uppercase tracking-widest">Utsho Member</div></div>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="p-2 text-zinc-500 hover:text-red-400"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col pt-14 md:pt-0 relative overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full pointer-events-none overflow-hidden">
          <div className={`absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full blur-[120px] opacity-10 ${userProfile.gender === 'male' ? 'bg-indigo-600' : 'bg-pink-600'}`} />
          <div className={`absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full blur-[120px] opacity-10 ${userProfile.gender === 'male' ? 'bg-purple-600' : 'bg-rose-600'}`} />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-8 custom-scrollbar z-10">
          <div className="max-w-3xl mx-auto space-y-6">
            {activeSession?.messages.length === 0 ? (
              <div className="h-[70vh] flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in zoom-in duration-500">
                <div className={`w-20 h-20 rounded-3xl flex items-center justify-center transition-all ${userProfile.gender === 'male' ? 'bg-indigo-500/10 text-indigo-400 shadow-[0_0_30px_rgba(99,102,241,0.15)] ring-1 ring-indigo-500/20' : 'bg-pink-500/10 text-pink-400 shadow-[0_0_30px_rgba(244,114,182,0.15)] ring-1 ring-pink-500/20'}`}>
                  <Sparkles size={40} className="animate-pulse" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-3xl font-bold tracking-tight">কেমন আছো, {userProfile.name}?</h2>
                  <p className="text-zinc-500 max-w-sm mx-auto">{userProfile.gender === 'male' ? 'আজ কি নিয়ে কথা বলবি ব্রো? আমি রেডি আছি একদম!' : 'আমি তোমার জন্য অনেকক্ষণ ধরে অপেক্ষা করছিলাম। চলো অনেক গল্প করি!'}</p>
                </div>
              </div>
            ) : (
              activeSession?.messages.map((m) => (
                <div key={m.id} className={`flex gap-3 animate-in fade-in slide-in-from-bottom-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'model' && (
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-1 ring-1 ${userProfile.gender === 'male' ? 'bg-indigo-500/10 text-indigo-400 ring-indigo-500/20' : 'bg-pink-500/10 text-pink-400 ring-pink-500/20'}`}>
                      <Sparkles size={16} />
                    </div>
                  )}
                  <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${m.role === 'user' ? (userProfile.gender === 'male' ? 'bg-indigo-600 text-white shadow-indigo-900/20' : 'bg-pink-600 text-white shadow-pink-900/20') : 'bg-zinc-900/80 backdrop-blur-md border border-zinc-800 text-zinc-200'}`}>
                    {m.content}
                    {!m.content && isLoading && (
                      <div className="flex flex-col gap-2 py-1">
                        <div className="flex gap-1.5">
                          <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"></div>
                          <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                          <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-medium italic animate-pulse">{apiStatusText}</span>
                      </div>
                    )}
                  </div>
                  {m.role === 'user' && (
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold shrink-0 mt-1 shadow-md ${userProfile.gender === 'male' ? 'bg-indigo-700 ring-1 ring-indigo-500' : 'bg-pink-700 ring-1 ring-pink-500'}`}>
                      {userProfile.name[0].toUpperCase()}
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="p-4 md:p-8 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-transparent z-20">
          <div className="max-w-3xl mx-auto relative group">
            <textarea
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
              placeholder="আপনার বার্তাটি এখানে লিখুন..."
              className="w-full bg-zinc-900/50 backdrop-blur-2xl border border-zinc-800 text-zinc-100 py-4 pl-4 pr-14 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all resize-none shadow-2xl"
              style={{ maxHeight: '150px' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 150)}px`;
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputText.trim() || isLoading}
              className={`absolute right-3 bottom-3 p-2.5 rounded-xl transition-all shadow-lg ${inputText.trim() && !isLoading ? (userProfile.gender === 'male' ? 'bg-indigo-500 text-white hover:scale-110 active:scale-95' : 'bg-pink-500 text-white hover:scale-110 active:scale-95') : 'bg-zinc-800 text-zinc-600'}`}
            >
              <Send size={18} />
            </button>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-4 opacity-40 hover:opacity-100 transition-opacity">
               <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em] flex items-center gap-1.5">
                <ShieldCheck size={10} className="text-emerald-500" /> Secure Connection
               </span>
               <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em] flex items-center gap-1.5">
                <Globe size={10} className="text-indigo-400" /> Shared Public Pool
               </span>
               <a href="https://www.facebook.com/shakkhor12102005/" target="_blank" className="text-[9px] text-zinc-500 flex items-center gap-1 hover:text-indigo-400 font-bold uppercase tracking-widest"><Facebook size={10} /> Shakkhor Paul</a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
