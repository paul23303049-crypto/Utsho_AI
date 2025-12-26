
import React, { useState, useEffect, useRef } from 'react';
import { Send, Plus, MessageSquare, Trash2, Menu, X, Sparkles, Heart, User, LogOut, Facebook } from 'lucide-react';
import { ChatSession, Message, UserProfile, Gender } from './types';
import { streamChatResponse } from './services/geminiService';

const App: React.FC = () => {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Onboarding States
  const [onboardingName, setOnboardingName] = useState('');
  const [onboardingGender, setOnboardingGender] = useState<Gender | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load User Profile
    const savedProfile = localStorage.getItem('utsho_profile');
    if (savedProfile) {
      setUserProfile(JSON.parse(savedProfile));
    }

    // Load Sessions
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
  }, [sessions, activeSessionId]);

  const handleOnboarding = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onboardingName.trim() || !onboardingGender) return;
    
    const profile: UserProfile = { name: onboardingName, gender: onboardingGender };
    setUserProfile(profile);
    localStorage.setItem('utsho_profile', JSON.stringify(profile));
    createNewSession();
  };

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to log out? This will clear your chat history.')) {
      localStorage.removeItem('utsho_profile');
      localStorage.removeItem('chat_sessions');
      setUserProfile(null);
      setSessions([]);
      setActiveSessionId(null);
      setOnboardingName('');
      setOnboardingGender(null);
    }
  };

  const createNewSession = () => {
    const newId = crypto.randomUUID();
    const newSession: ChatSession = {
      id: newId,
      title: 'New Conversation',
      messages: [],
      createdAt: new Date(),
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (activeSessionId === id) {
        setActiveSessionId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
    if (sessions.length <= 1) {
      localStorage.removeItem('chat_sessions');
      createNewSession();
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

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
    const aiPlaceholder: Message = {
      id: aiMessageId,
      role: 'model',
      content: '',
      timestamp: new Date(),
    };

    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, messages: [...s.messages, aiPlaceholder] };
      }
      return s;
    }));

    await streamChatResponse(
      [...(activeSession?.messages || []), userMessage],
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
      () => setIsLoading(false),
      () => {
        setIsLoading(false);
        setSessions(prev => prev.map(s => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: s.messages.map(m => m.id === aiMessageId ? { ...m, content: "⚠️ Something went wrong. Please try again." } : m)
            };
          }
          return s;
        }));
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Onboarding View
  if (!userProfile) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in duration-500">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-indigo-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Sparkles size={32} />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center mb-2">Welcome to Utsho</h1>
          <p className="text-zinc-500 text-center mb-8 text-sm">Let's get to know you first.</p>
          
          <form onSubmit={handleOnboarding} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">What's your name?</label>
              <input 
                type="text" 
                value={onboardingName}
                onChange={(e) => setOnboardingName(e.target.value)}
                placeholder="Enter your name"
                required
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-3">Select your gender</label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setOnboardingGender('male')}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl border transition-all ${onboardingGender === 'male' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}
                >
                  <User size={18} />
                  <span>Male</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOnboardingGender('female')}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl border transition-all ${onboardingGender === 'female' ? 'bg-pink-600 border-pink-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}
                >
                  <Heart size={18} />
                  <span>Female</span>
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={!onboardingName || !onboardingGender}
              className="w-full bg-zinc-100 text-zinc-950 font-bold py-4 rounded-xl hover:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Chatting
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-zinc-900/80 backdrop-blur-md border-b border-zinc-800 z-40 flex items-center justify-between px-4">
        <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-zinc-800 rounded-lg transition-colors">
          <Menu size={20} />
        </button>
        <div className="font-semibold flex items-center gap-2">
          <Sparkles size={18} className="text-indigo-400" />
          <span>Utsho</span>
        </div>
        <button onClick={createNewSession} className="p-2 hover:bg-zinc-800 rounded-lg transition-colors">
          <Plus size={20} />
        </button>
      </div>

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 md:hidden" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:relative z-50 inset-y-0 left-0 w-72 bg-zinc-900 border-r border-zinc-800 flex flex-col transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="p-4 flex items-center justify-between">
          <button 
            onClick={createNewSession}
            className="flex-1 flex items-center justify-center gap-2 bg-zinc-100 text-zinc-950 py-2.5 px-4 rounded-xl font-medium hover:bg-zinc-200 transition-all hover:scale-[0.98]"
          >
            <Plus size={18} />
            <span>New Chat</span>
          </button>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 ml-2 hover:bg-zinc-800 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
          <div className="px-2 mb-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Conversations</div>
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => {
                setActiveSessionId(session.id);
                if (window.innerWidth < 768) setIsSidebarOpen(false);
              }}
              className={`
                group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all relative
                ${activeSessionId === session.id ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'}
              `}
            >
              <MessageSquare size={18} className={activeSessionId === session.id ? 'text-indigo-400' : 'text-zinc-500'} />
              <div className="flex-1 truncate pr-6 text-sm font-medium">{session.title}</div>
              <button 
                onClick={(e) => deleteSession(e, session.id)}
                className="absolute right-2 opacity-0 group-hover:opacity-100 p-1.5 hover:bg-zinc-700 rounded-lg text-zinc-500 hover:text-red-400 transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center gap-3 bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-sm shrink-0 ${userProfile.gender === 'male' ? 'bg-indigo-600' : 'bg-pink-600'}`}>
              {userProfile.name[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate">{userProfile.name}</div>
              <div className="text-[10px] text-zinc-500 truncate uppercase tracking-widest font-medium">
                Active {userProfile.gender === 'male' ? 'Bro' : 'Queen'}
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-zinc-500 hover:text-red-400 hover:bg-zinc-700 rounded-lg transition-all"
              title="Log out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 pt-14 md:pt-0">
        <div className="flex-1 overflow-y-auto px-4 py-8">
          <div className="max-w-3xl mx-auto space-y-8">
            {activeSession?.messages.length === 0 ? (
              <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in zoom-in duration-700">
                <div className={`w-20 h-20 rounded-3xl flex items-center justify-center shadow-2xl transition-all ${userProfile.gender === 'male' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-pink-500/10 text-pink-400'}`}>
                  <Sparkles size={40} />
                </div>
                <div className="space-y-2">
                  <h2 className="text-3xl font-extrabold tracking-tight">Hey {userProfile.name}!</h2>
                  <p className="text-zinc-500 max-w-sm">
                    {userProfile.gender === 'male' 
                      ? "What's on your mind today, bro?" 
                      : "I've been waiting for you. What shall we talk about?"}
                  </p>
                </div>
              </div>
            ) : (
              activeSession?.messages.map((message) => (
                <div key={message.id} className={`flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {message.role === 'model' && (
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${userProfile.gender === 'male' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-pink-500/20 text-pink-400'}`}>
                      <Sparkles size={16} />
                    </div>
                  )}
                  <div className={`
                    max-w-[85%] md:max-w-[75%] p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
                    ${message.role === 'user' 
                      ? (userProfile.gender === 'male' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/10' : 'bg-pink-600 text-white shadow-lg shadow-pink-900/10')
                      : 'bg-zinc-900 text-zinc-200 border border-zinc-800 shadow-sm'}
                  `}>
                    {message.content || (isLoading && <div className="flex gap-1 py-1"><div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"></div><div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.2s]"></div><div className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.4s]"></div></div>)}
                  </div>
                  {message.role === 'user' && (
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold shrink-0 mt-1 ${userProfile.gender === 'male' ? 'bg-indigo-700' : 'bg-pink-700'}`}>
                      {userProfile.name[0].toUpperCase()}
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="p-4 md:p-8 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-transparent">
          <div className="max-w-3xl mx-auto relative space-y-4">
            <div className="relative">
              <textarea
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Message Utsho...`}
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 py-4 pl-4 pr-14 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all resize-none shadow-2xl"
                style={{ maxHeight: '200px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                }}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputText.trim() || isLoading}
                className={`
                  absolute right-3 bottom-3 p-2.5 rounded-xl transition-all
                  ${inputText.trim() && !isLoading
                    ? (userProfile.gender === 'male' ? 'bg-indigo-500 text-white' : 'bg-pink-500 text-white') + ' hover:scale-105 active:scale-95'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'}
                `}
              >
                <Send size={18} />
              </button>
            </div>
            
            <footer className="flex items-center justify-center gap-2 py-2">
              <span className="text-zinc-600 text-xs">Developed by</span>
              <a 
                href="https://www.facebook.com/shakkhor12102005/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-zinc-400 hover:text-indigo-400 transition-colors text-xs font-medium"
              >
                <Facebook size={12} className="text-indigo-500" />
                Shakkhor
              </a>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
