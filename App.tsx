
import React, { useState, useEffect, useRef } from 'react';
import { Send, Plus, MessageSquare, Trash2, Menu, Sparkles, LogOut, RefreshCcw, Settings, Globe, AlertCircle, Paperclip, X, Facebook, Instagram } from 'lucide-react';
import { ChatSession, Message, UserProfile, Gender } from './types';
import { streamChatResponse, checkApiHealth, getPoolStatus, adminResetPool, getLastNodeError, getActiveKey } from './services/groqService';
import { generateImage, getRemainingImageGenerations, getImageDailyLimit } from './services/imageService';
import { analyzeConversation } from './services/userLearningService';
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
  const [connectionHealth, setConnectionHealth] = useState<'perfect' | 'error'>('perfect');
  const [poolInfo, setPoolInfo] = useState({ total: 0, active: 0, exhausted: 0 });
  const [lastErrorDiagnostic, setLastErrorDiagnostic] = useState<string>("None");
  
  const [onboardingStep, setOnboardingStep] = useState<1 | 2 | 4>(1);
  const [tempAge, setTempAge] = useState<string>('');
  const [tempGender, setTempGender] = useState<Gender | null>(null);
  const [customKeyInput, setCustomKeyInput] = useState('');
  
  const [selectedImage, setSelectedImage] = useState<{ data: string, mimeType: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = userProfile ? db.isAdmin(userProfile.email) : false;
  const isUserDebi = userProfile ? db.isDebi(userProfile.email) : false;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeSessionId, isLoading]);

  useEffect(() => {
    const bootApp = async () => {
      const localProfileStr = localStorage.getItem('utsho_profile');
      if (localProfileStr) {
        const localProfile = JSON.parse(localProfileStr) as UserProfile;
        setUserProfile(localProfile);
        setCustomKeyInput(localProfile.customApiKey || '');
        
        if (!localProfile.age || !localProfile.gender || localProfile.age === 0) {
          setOnboardingStep(2);
        } else {
          setOnboardingStep(4);
        }
        
        if (db.isDatabaseEnabled()) {
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
            console.error("Cloud boot error:", e);
          }
        }
        await performHealthCheck(localProfile);
      }
    };
    bootApp();
    const interval = setInterval(() => {
      setPoolInfo(getPoolStatus());
      const err = getLastNodeError();
      if (err !== "None") {
        setLastErrorDiagnostic(err.length > 80 ? err.substring(0, 80) + "..." : err);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleGoogleLogin = async () => {
    const googleUser = await db.loginWithGoogle();
    if (googleUser) {
      const cloud = await db.getUserProfile(googleUser.email);
      if (cloud && cloud.age > 0) {
        setUserProfile(cloud);
        setCustomKeyInput(cloud.customApiKey || '');
        localStorage.setItem('utsho_profile', JSON.stringify(cloud));
        setOnboardingStep(4);
        const s = await db.getSessions(googleUser.email);
        setSessions(s);
        if (s.length > 0) setActiveSessionId(s[0].id); else createNewSession(googleUser.email);
      } else {
        setUserProfile(googleUser);
        setOnboardingStep(2);
      }
    }
  };

  const finalizePersonalization = async () => {
    if (!userProfile || !tempGender || !tempAge) return;
    const final: UserProfile = { ...userProfile, age: parseInt(tempAge) || 20, gender: tempGender };
    setUserProfile(final);
    localStorage.setItem('utsho_profile', JSON.stringify(final));
    if (db.isDatabaseEnabled()) await db.saveUserProfile(final);
    setOnboardingStep(4);
    if (sessions.length === 0) createNewSession(final.email);
    await performHealthCheck(final);
  };

  const performHealthCheck = async (profile?: UserProfile) => {
    setApiStatusText('Verifying...');
    const { healthy, error } = await checkApiHealth(profile || userProfile || undefined);
    setConnectionHealth(healthy ? 'perfect' : 'error');
    setApiStatusText(healthy ? 'Synced' : 'Node Issue');
    setPoolInfo(getPoolStatus());
    if (error && error !== "ping") setLastErrorDiagnostic(error.substring(0, 80));
  };

  const handleResetPool = () => {
    adminResetPool();
    performHealthCheck();
  };

  const saveSettings = async () => {
    if (!userProfile) return;
    const updated = { ...userProfile, customApiKey: customKeyInput.trim() };
    setUserProfile(updated);
    localStorage.setItem('utsho_profile', JSON.stringify(updated));
    if (db.isDatabaseEnabled()) await db.saveUserProfile(updated);
    setIsSettingsOpen(false);
    await performHealthCheck(updated);
  };

  const createNewSession = (emailOverride?: string) => {
    const sid = crypto.randomUUID();
    const newSession = { id: sid, title: 'New Chat', messages: [], createdAt: new Date() };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(sid);
    if (db.isDatabaseEnabled()) db.saveSession(emailOverride || userProfile!.email, newSession).catch(console.error);
  };

  const handleSendMessage = async () => {
    if (!userProfile) return;
    
    if ((!inputText.trim() && !selectedImage) || isLoading || !activeSessionId) return;
    
    const userMsg: Message = { 
      id: crypto.randomUUID(), 
      role: 'user', 
      content: inputText, 
      timestamp: new Date(),
      imagePart: selectedImage || undefined,
      imageUrl: imagePreview || undefined
    };
    
    const currentSession = sessions.find(s => s.id === activeSessionId)!;
    const history = [...currentSession.messages, userMsg];
    const isFirstMessage = currentSession.messages.length === 0;
    const newTitle = isFirstMessage ? (userMsg.content.slice(0, 30) || "Image Analysis") : currentSession.title;
    
    setInputText('');
    setSelectedImage(null);
    setImagePreview(null);
    setIsLoading(true);
    setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: history, title: newTitle } : s));

    if (db.isDatabaseEnabled()) {
      db.updateSessionMessages(userProfile.email, activeSessionId, history, newTitle).catch(console.error);
    }

    // Check for image generation request
    const lowerInput = inputText.toLowerCase();
    const isImageRequest = lowerInput.startsWith('/draw') || 
                          lowerInput.startsWith('/image') ||
                          lowerInput.includes('generate image') ||
                          lowerInput.includes('generate a picture') ||
                          lowerInput.includes('draw a picture') ||
                          lowerInput.includes('draw me a') ||
                          lowerInput.includes('create an image') ||
                          lowerInput.includes('ছবি আঁকো') ||
                          lowerInput.includes('ছবি তৈরি করো') ||
                          lowerInput.includes('একটি ছবি');

    if (isImageRequest) {
      // Check rate limit before attempting generation
      const remaining = getRemainingImageGenerations(userProfile.email);
      if (remaining <= 0) {
        setIsLoading(false);
        const limitMsg: Message = {
          id: crypto.randomUUID(),
          role: 'model',
          content: `You've reached your daily image generation limit (${getImageDailyLimit()} images per day). Your limit will reset tomorrow. Try again then!`,
          timestamp: new Date()
        };
        const updatedMessages = [...history, limitMsg];
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: updatedMessages } : s));
        if (db.isDatabaseEnabled()) db.updateSessionMessages(userProfile.email, activeSessionId, updatedMessages, newTitle).catch(console.error);
        setApiStatusText("Daily Limit Reached");
        return;
      }

      setApiStatusText(`Generating image... (${remaining - 1} left today)`);
      
      const imagePrompt = inputText
        .replace(/^\/(draw|image)\s*/i, '')
        .replace(/^generate (image|picture) of/i, '')
        .replace(/^draw (a picture|an image) of/i, '')
        .replace(/^create (an image|a picture) of/i, '')
        .replace(/^(ছবি আঁকো|ছবি তৈরি করো|একটি ছবি)\s*/i, '')
        .trim() || "A beautiful landscape";
      const imageUrl = await generateImage(imagePrompt, userProfile.email);

      if (imageUrl) {
        setIsLoading(false);
        const newRemaining = getRemainingImageGenerations(userProfile.email);
        const imageMsg: Message = { 
          id: crypto.randomUUID(), 
          role: 'model', 
          content: `Here is your generated image for: "${imagePrompt}"\n(${newRemaining}/${getImageDailyLimit()} generations remaining today)`, 
          timestamp: new Date(),
          imageUrl: imageUrl
        };
        const updatedMessages = [...history, imageMsg];
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: updatedMessages } : s));
        if (db.isDatabaseEnabled()) db.updateSessionMessages(userProfile.email, activeSessionId, updatedMessages, newTitle).catch(console.error);
        setApiStatusText("Image Generated");
        return;
      } else {
        setIsLoading(false);
        const errorMsg: Message = { 
          id: crypto.randomUUID(), 
          role: 'model', 
          content: "Sorry, I couldn't generate that image right now. Please try again later.", 
          timestamp: new Date() 
        };
        const updatedMessages = [...history, errorMsg];
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: updatedMessages } : s));
        setApiStatusText("Error Generating Image");
        return;
      }
    }

    await streamChatResponse(
      history,
      userProfile,
      (chunk) => {},
      (fullText, sources, imageUrl) => {
        setIsLoading(false);
        const parts = fullText.split('[SPLIT]').map(p => p.trim()).filter(p => p.length > 0);
        const newMessages: Message[] = parts.map((p, i) => ({
          id: crypto.randomUUID(),
          role: 'model',
          content: p,
          timestamp: new Date(),
          sources: i === parts.length - 1 ? sources : undefined,
          imageUrl: i === 0 ? imageUrl : undefined
        }));
        
        const updatedMessages = [...history, ...newMessages];
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: updatedMessages } : s));
        if (db.isDatabaseEnabled()) db.updateSessionMessages(userProfile.email, activeSessionId, updatedMessages, newTitle).catch(console.error);
        setPoolInfo(getPoolStatus());
        setApiStatusText("Synced");

        // Background: analyze conversation to learn about the user
        const learningKey = getActiveKey(userProfile);
        if (learningKey) {
          analyzeConversation(updatedMessages, userProfile, learningKey).catch(() => {});
        }
      },
      (err) => {
        setIsLoading(false);
        const errMsg = err.message || "Connection Error";
        setLastErrorDiagnostic(errMsg);
        const errorMsg: Message = { id: crypto.randomUUID(), role: 'model', content: `Failure: ${errMsg}`, timestamp: new Date() };
        const finalMessages = [...history, errorMsg];
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, messages: finalMessages } : s));
        if (db.isDatabaseEnabled()) db.updateSessionMessages(userProfile.email, activeSessionId, finalMessages, newTitle).catch(console.error);
        setApiStatusText("Pool Error");
      },
      (status) => setApiStatusText(status)
    );
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const originalBase64 = reader.result as string;
      const dataOnly = originalBase64.split(',')[1];
      setSelectedImage({ data: dataOnly, mimeType: 'image/jpeg' });
      setImagePreview(originalBase64);
    };
    reader.readAsDataURL(file);
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  if (onboardingStep === 1) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-[3rem] p-12 shadow-2xl space-y-8 text-center animate-in fade-in duration-500">
        <div className="w-20 h-20 rounded-3xl mx-auto flex items-center justify-center text-white floating-ai shadow-lg bg-indigo-600 shadow-indigo-600/30"><Sparkles size={40} /></div>
        <div className="space-y-2">
          <h1 className="text-3xl font-black tracking-tighter">UTSHO AI</h1>
          <p className="text-zinc-500 text-sm font-medium">Your Personal AI Assistant</p>
        </div>
        <button onClick={handleGoogleLogin} className="w-full bg-white text-zinc-950 font-bold py-4 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="" /> Sign in with Google
        </button>
      </div>
    </div>
  );

  if (onboardingStep === 2) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in fade-in zoom-in duration-300">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-black">Personalize Utsho</h2>
          <p className="text-zinc-500 text-sm">Tell me about yourself for better service.</p>
        </div>
        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1">Gender</label>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setTempGender('male')} className={`py-4 rounded-2xl border-2 font-bold transition-all ${tempGender === 'male' ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}>Male</button>
              <button onClick={() => setTempGender('female')} className={`py-4 rounded-2xl border-2 font-bold transition-all ${tempGender === 'female' ? 'bg-pink-600 border-pink-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}>Female</button>
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-1">Age</label>
            <input type="number" value={tempAge} onChange={e => setTempAge(e.target.value)} placeholder="e.g. 24" className="w-full bg-zinc-800 border border-zinc-700 p-4 rounded-2xl outline-none focus:border-indigo-500 text-white font-bold" />
          </div>
          <button onClick={finalizePersonalization} disabled={!tempGender || !tempAge} className={`w-full font-bold py-4 rounded-2xl active:scale-95 transition-all ${(!tempGender || !tempAge) ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-white text-zinc-950 shadow-xl'}`}>Save & Continue</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-['Hind_Siliguri',_sans-serif]">
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm bg-black/50">
           <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-3xl w-full max-w-md space-y-6 shadow-2xl">
              <h3 className="text-xl font-bold flex items-center gap-2 text-indigo-400"><Settings size={20} /> Settings</h3>
              <div className="space-y-2">
                 <label className="text-xs font-bold text-zinc-500">YOUR PERSONAL API KEY (OPTIONAL)</label>
                 <input type="password" value={customKeyInput} onChange={e => setCustomKeyInput(e.target.value)} placeholder="Paste your Groq key here..." className="w-full bg-zinc-800 border border-zinc-700 p-4 rounded-xl outline-none focus:border-indigo-500 text-sm" />
                 <p className="text-[10px] text-zinc-500 italic">If left blank, Utsho will use the shared community pool.</p>
              </div>
              <div className="flex gap-3">
                 <button onClick={() => setIsSettingsOpen(false)} className="flex-1 py-3 font-bold border border-zinc-700 rounded-xl hover:bg-zinc-800">Cancel</button>
                 <button onClick={saveSettings} className="flex-1 py-3 font-bold bg-indigo-600 rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-600/20">Save</button>
              </div>
           </div>
        </div>
      )}

      <aside className={`fixed md:relative z-50 inset-y-0 left-0 w-72 bg-zinc-900 border-r border-zinc-800 flex flex-col transition-transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-4 flex flex-col gap-4">
          <button onClick={() => createNewSession()} className="bg-zinc-100 text-zinc-950 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg hover:bg-white transition-all active:scale-95"><Plus size={18} /> New Chat</button>
          
          <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-[2rem] shadow-2xl space-y-4">
             <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                   {isAdmin ? 'POOL HEALTH' : 'SYSTEM POOL'}
                </div>
                {isAdmin && <button onClick={handleResetPool} className="text-zinc-600 hover:text-indigo-400 transition-colors"><RefreshCcw size={12} /></button>}
             </div>
             
             <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-zinc-500">AVAILABLE NODES</span>
                  <span className="text-[10px] font-black text-emerald-400">{poolInfo.active}/{poolInfo.total}</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${(poolInfo.active / Math.max(1, poolInfo.total)) * 100}%` }} />
                </div>
             </div>

             <div className="pt-2 border-t border-zinc-800">
                <div className={`text-[9px] font-black text-center py-1 rounded-lg truncate ${connectionHealth === 'error' ? 'text-red-400 bg-red-400/5' : 'text-zinc-400 bg-zinc-800/50'}`}>
                  {apiStatusText.toUpperCase()} {isLoading && "..."}
                </div>
             </div>
          </div>

          <div className="flex items-center justify-between px-3 py-2 bg-zinc-800/30 rounded-xl border border-zinc-800/50">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Settings</span>
            <button onClick={() => setIsSettingsOpen(true)} className="text-zinc-700 hover:text-indigo-400 transition-colors"><Settings size={14} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1 scrollbar-hide">
          {sessions.map(s => (
            <div key={s.id} onClick={() => { setActiveSessionId(s.id); if(window.innerWidth < 768) setIsSidebarOpen(false); }} className={`group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all ${activeSessionId === s.id ? 'bg-zinc-800 text-white border border-zinc-700 shadow-xl' : 'hover:bg-zinc-800/40 text-zinc-500 border border-transparent'}`}>
              <MessageSquare size={16} className={activeSessionId === s.id ? 'text-indigo-400' : ''} /> 
              <div className="flex-1 truncate text-sm font-medium">{s.title}</div>
              <button onClick={(e) => { e.stopPropagation(); db.deleteSession(userProfile!.email, s.id); setSessions(prev => prev.filter(x => x.id !== s.id)); }} className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800 flex flex-col gap-3 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <img src={userProfile?.picture} className="w-9 h-9 rounded-full border border-zinc-700" alt="" />
            <div className="flex-1 truncate text-[11px] font-bold text-zinc-400 leading-tight">
              {userProfile?.name} <br/> 
              <span className="text-[9px] uppercase tracking-widest font-black text-zinc-600">{userProfile?.age}Y • {userProfile?.gender}</span>
            </div>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="text-zinc-600 hover:text-red-500 transition-colors"><LogOut size={16} /></button>
          </div>
          <div className="pt-2 border-t border-zinc-800/50 flex flex-col items-center gap-2 text-zinc-600 font-bold uppercase tracking-widest text-[9px]">
            <div className="flex items-center gap-4">
              <a href="https://facebook.com/shakkhor12102005" target="_blank" className="hover:text-indigo-400 transition-all hover:scale-110"><Facebook size={14}/></a>
              <a href="https://instagram.com/shakkhor_paul/" target="_blank" className="hover:text-pink-400 transition-all hover:scale-110"><Instagram size={14}/></a>
            </div>
            Developed by Shakkhor Paul
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <div className="md:hidden h-14 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md flex items-center px-4 sticky top-0 z-40">
          <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 text-zinc-400 hover:text-white"><Menu size={20} /></button>
          <div className="flex-1 text-center font-black tracking-tighter text-indigo-500 text-lg">UTSHO AI</div>
          <button onClick={() => createNewSession()} className="p-2 text-zinc-400 hover:text-white"><Plus size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-8 custom-scrollbar">
          <div className="max-w-3xl mx-auto space-y-6 pb-4">
            {!activeSession || activeSession.messages.length === 0 ? (
              <div className="h-[65vh] flex flex-col items-center justify-center space-y-6 text-center animate-in fade-in slide-in-from-top-8 duration-700">
                <div className="w-28 h-28 rounded-[2.5rem] flex items-center justify-center shadow-2xl floating-ai bg-indigo-600 shadow-indigo-600/20"><Sparkles size={48} /></div>
                <div className="space-y-2 px-4">
                  <h3 className="text-3xl font-black tracking-tight">Hey {userProfile?.name.split(' ')[0]}!</h3>
                  <p className="text-zinc-500 text-sm max-w-xs mx-auto font-medium">Fullstack Adaptive Identity Engaged. <br/> How can I help you today?</p>
                </div>
              </div>
            ) : (
              activeSession.messages.map(m => (
                <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-in slide-in-from-bottom-2 duration-300`}>
                   <div className={`flex flex-col gap-2 max-w-[90%] md:max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {m.imageUrl && (
                        <div className="rounded-[2rem] overflow-hidden border border-zinc-800 shadow-2xl mb-1">
                           <img src={m.imageUrl} className="max-w-full h-auto max-h-[300px] object-cover" alt="User upload" />
                        </div>
                      )}
                      {m.content && (
                        <div className={`p-4 md:p-5 rounded-[2rem] text-[15px] bangla-text shadow-xl ${m.role === 'user' ? 'bg-indigo-600 shadow-indigo-500/20 text-white rounded-tr-none' : 'bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-none'} ${m.content.startsWith("Failure") ? 'border-red-500/30 bg-red-500/5 text-red-400' : ''}`}>
                          {m.content.startsWith("Failure") && <AlertCircle size={14} className="inline mr-2" />}
                          {m.content}
                        </div>
                      )}
                      {m.sources && m.sources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1 ml-1">
                          {m.sources.map((s: any, idx: number) => (
                            <a key={idx} href={s.uri} target="_blank" className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 py-1.5 px-3.5 rounded-2xl text-[10px] text-zinc-500 hover:text-white transition-all shadow-sm">
                              <Globe size={10} className="text-indigo-400" /> <span className="max-w-[120px] truncate font-bold">{s.title}</span>
                            </a>
                          ))}
                        </div>
                      )}
                   </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="p-4 md:p-8 bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-900/50">
          <div className="max-w-3xl mx-auto space-y-4">
            {imagePreview && (
              <div className="relative inline-block animate-in fade-in zoom-in duration-300">
                <img src={imagePreview} className="w-24 h-24 object-cover rounded-3xl border-2 border-indigo-500/40 shadow-2xl" alt="Preview" />
                <button onClick={() => { setSelectedImage(null); setImagePreview(null); }} className="absolute -top-2 -right-2 bg-red-500 text-white p-1.5 rounded-full shadow-lg hover:scale-110 transition-transform"><X size={14} /></button>
              </div>
            )}
            <div className="flex items-end gap-2 bg-zinc-900/80 border border-zinc-800 rounded-[2.5rem] p-2.5 shadow-2xl focus-within:border-indigo-500/30 transition-all">
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageSelect} />
              <button onClick={() => fileInputRef.current?.click()} className="p-3.5 text-zinc-500 hover:text-indigo-400 transition-colors"><Paperclip size={22} /></button>
              <textarea rows={1} value={inputText} onChange={e => { setInputText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder="Talk to Utsho..." className="flex-1 bg-transparent py-3.5 px-2 outline-none resize-none max-h-40 text-[15px] text-zinc-100 placeholder-zinc-600" />
              <button onClick={handleSendMessage} disabled={isLoading} className={`p-4 rounded-full transition-all active:scale-90 shadow-xl ${ (inputText.trim() || selectedImage) && !isLoading ? 'bg-indigo-600 shadow-indigo-500/20' : 'bg-zinc-800 text-zinc-600'}`}>
                 {isLoading ? <RefreshCcw size={22} className="animate-spin" /> : <Send size={22} />}
              </button>
            </div>
            <p className="text-[10px] text-center text-zinc-600 font-bold uppercase tracking-widest">UTSHO CAN MAKE MISTAKES. CHECK IMPORTANT INFO.</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
