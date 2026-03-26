
import React, { useState, useEffect, useRef } from 'react';
import { Send, Plus, MessageSquare, Trash2, Menu, Sparkles, LogOut, RefreshCcw, Settings, Globe, AlertCircle, Paperclip, X, Facebook, Instagram, Palette, Check } from 'lucide-react';
import { ChatSession, Message, UserProfile, Gender, ApiProvider } from './types';
import { streamChatResponse, checkApiHealth, getPoolStatus, adminResetPool, getLastNodeError, getActiveKey } from './services/aiService';
import { generateImage, getRemainingImageGenerations, getImageDailyLimit } from './services/imageService';
import { analyzeConversation, selfAssessResponse, deepReflection } from './services/userLearningService';
import { parseFile, detectFileType, getFileTypeLabel } from './services/fileParserService';
import * as db from './services/firebaseService';
import { useTheme } from './ThemeContext';
import { themes, themeNames, ThemeName } from './themes';

const App: React.FC = () => {
  const { currentTheme, theme, setTheme } = useTheme();
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
  const [customProviderInput, setCustomProviderInput] = useState<ApiProvider>('chatgpt');
  
  const [selectedImage, setSelectedImage] = useState<{ data: string, mimeType: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<{ text: string, fileName: string, fileType: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = userProfile ? db.isAdmin(userProfile.email) : false;
  const isUserDebi = userProfile ? db.isDebi(userProfile.email) : false;

  const c = theme.colors;

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
        setCustomProviderInput(localProfile.customApiProvider || 'chatgpt');
        
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
    const updated = { ...userProfile, customApiKey: customKeyInput.trim(), customApiProvider: customProviderInput };
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
    
    if ((!inputText.trim() && !selectedImage && !selectedDocument) || isLoading || !activeSessionId) return;
    
    // Build message content: if a document is attached, prepend its content
    let messageContent = inputText;
    if (selectedDocument) {
      const docPrefix = `[Attached file: ${selectedDocument.fileName}]\n\n${selectedDocument.text}\n\n`;
      messageContent = inputText.trim() 
        ? `${docPrefix}User's question: ${inputText}` 
        : `${docPrefix}Please analyze this document.`;
    }
    
    const userMsg: Message = { 
      id: crypto.randomUUID(), 
      role: 'user', 
      content: messageContent, 
      timestamp: new Date(),
      imagePart: selectedImage || undefined,
      imageUrl: imagePreview || undefined,
      documentName: selectedDocument?.fileName || undefined
    };
    
    const currentSession = sessions.find(s => s.id === activeSessionId)!;
    const history = [...currentSession.messages, userMsg];
    const isFirstMessage = currentSession.messages.length === 0;
    const titleHint = selectedDocument ? selectedDocument.fileName : (userMsg.content.slice(0, 30) || "Image Analysis");
    const newTitle = isFirstMessage ? titleHint : currentSession.title;
    
    setInputText('');
    setSelectedImage(null);
    setImagePreview(null);
    setSelectedDocument(null);
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

        // Background: self-training pipeline
        const learningKey = getActiveKey(userProfile);
        if (learningKey) {
          // 1. Analyze conversation to learn about the user
          analyzeConversation(updatedMessages, userProfile, learningKey).catch(() => {});
          // 2. Self-assess response quality and generate improvement notes
          selfAssessResponse(updatedMessages, userProfile, learningKey).catch(() => {});
          // 3. Periodic deep reflection to synthesize all learnings
          deepReflection(userProfile, learningKey).catch(() => {});
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const fileType = detectFileType(file);
    
    if (fileType === 'image') {
      // Handle images as before (for vision model)
      const reader = new FileReader();
      reader.onloadend = () => {
        const originalBase64 = reader.result as string;
        const dataOnly = originalBase64.split(',')[1];
        setSelectedImage({ data: dataOnly, mimeType: file.type || 'image/jpeg' });
        setImagePreview(originalBase64);
        setSelectedDocument(null);
      };
      reader.readAsDataURL(file);
    } else {
      // Handle documents (PDF, DOCX, TXT, etc.)
      try {
        setApiStatusText("Parsing file...");
        const parsed = await parseFile(file);
        setSelectedDocument({ text: parsed.text, fileName: parsed.fileName, fileType: getFileTypeLabel(parsed.fileType) });
        setSelectedImage(null);
        setImagePreview(null);
        setApiStatusText("File ready");
      } catch (err) {
        console.error("FILE_PARSE_ERROR:", err);
        alert("Failed to parse this file. Please try a different file.");
        setApiStatusText("Parse error");
      }
    }
    
    // Reset file input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // --- Theme Picker Component ---
  const ThemePicker: React.FC = () => (
    <div className="space-y-3">
      <label className="text-xs font-bold uppercase tracking-widest pl-1" style={{ color: c.textMuted }}>
        <Palette size={12} className="inline mr-1.5" style={{ color: c.accent }} />
        THEME
      </label>
      <div className="grid grid-cols-3 gap-2">
        {themeNames.map((name) => {
          const t = themes[name];
          const isActive = currentTheme === name;
          return (
            <button
              key={name}
              onClick={() => setTheme(name)}
              className="relative flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 font-bold text-xs transition-all"
              style={{
                backgroundColor: isActive ? c.accentSubtle : c.bgTertiary,
                borderColor: isActive ? c.accent : c.borderPrimary,
                color: isActive ? c.accent : c.textSecondary,
              }}
            >
              {isActive && (
                <div className="absolute top-1 right-1">
                  <Check size={10} style={{ color: c.accent }} />
                </div>
              )}
              <div
                className="w-6 h-6 rounded-full border-2 flex items-center justify-center"
                style={{
                  backgroundColor: t.colors.bgPrimary,
                  borderColor: t.colors.accent,
                }}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: t.colors.accent }}
                />
              </div>
              <span className="text-[10px] font-bold">{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  if (onboardingStep === 1) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: c.bgPrimary }}>
      <div className="w-full max-w-md border rounded-[3rem] p-12 shadow-2xl space-y-8 text-center animate-in fade-in duration-500" style={{ backgroundColor: c.bgSecondary, borderColor: c.borderPrimary }}>
        <div className="w-20 h-20 rounded-3xl mx-auto flex items-center justify-center text-white floating-ai shadow-lg" style={{ backgroundColor: c.accent, boxShadow: `0 10px 30px ${c.accentShadow}` }}><Sparkles size={40} /></div>
        <div className="space-y-2">
          <h1 className="text-3xl font-black tracking-tighter" style={{ color: c.textPrimary }}>UTSHO AI</h1>
          <p className="text-sm font-medium" style={{ color: c.textMuted }}>Your Personal AI Assistant</p>
        </div>
        <button onClick={handleGoogleLogin} className="w-full font-bold py-4 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all" style={{ backgroundColor: c.buttonPrimary, color: c.buttonPrimaryText }}>
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="" /> Sign in with Google
        </button>
      </div>
    </div>
  );

  if (onboardingStep === 2) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: c.bgPrimary }}>
      <div className="w-full max-w-md border rounded-[3rem] p-10 shadow-2xl space-y-8 animate-in fade-in zoom-in duration-300" style={{ backgroundColor: c.bgSecondary, borderColor: c.borderPrimary }}>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-black" style={{ color: c.textPrimary }}>Personalize Utsho</h2>
          <p className="text-sm" style={{ color: c.textMuted }}>Tell me about yourself for better service.</p>
        </div>
        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-widest pl-1" style={{ color: c.textMuted }}>Gender</label>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setTempGender('male')} className="py-4 rounded-2xl border-2 font-bold transition-all" style={{ backgroundColor: tempGender === 'male' ? c.accent : c.bgTertiary, borderColor: tempGender === 'male' ? c.accent : c.borderPrimary, color: tempGender === 'male' ? '#fff' : c.textSecondary }}>Male</button>
              <button onClick={() => setTempGender('female')} className="py-4 rounded-2xl border-2 font-bold transition-all" style={{ backgroundColor: tempGender === 'female' ? '#db2777' : c.bgTertiary, borderColor: tempGender === 'female' ? '#ec4899' : c.borderPrimary, color: tempGender === 'female' ? '#fff' : c.textSecondary }}>Female</button>
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-widest pl-1" style={{ color: c.textMuted }}>Age</label>
            <input type="number" value={tempAge} onChange={e => setTempAge(e.target.value)} placeholder="e.g. 24" className="w-full border p-4 rounded-2xl outline-none font-bold" style={{ backgroundColor: c.bgInput, borderColor: c.borderPrimary, color: c.textPrimary }} />
          </div>
          <button onClick={finalizePersonalization} disabled={!tempGender || !tempAge} className="w-full font-bold py-4 rounded-2xl active:scale-95 transition-all" style={{ backgroundColor: (!tempGender || !tempAge) ? c.bgTertiary : c.buttonPrimary, color: (!tempGender || !tempAge) ? c.textMuted : c.buttonPrimaryText, cursor: (!tempGender || !tempAge) ? 'not-allowed' : 'pointer' }}>Save & Continue</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen font-['Hind_Siliguri',_sans-serif]" style={{ backgroundColor: c.bgPrimary, color: c.textPrimary }}>
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm bg-black/50">
           <div className="border p-8 rounded-3xl w-full max-w-md space-y-6 shadow-2xl" style={{ backgroundColor: c.bgSecondary, borderColor: c.borderPrimary }}>
              <h3 className="text-xl font-bold flex items-center gap-2" style={{ color: c.accent }}><Settings size={20} /> Settings</h3>
              
              <ThemePicker />

              <div className="space-y-2">
                 <label className="text-xs font-bold" style={{ color: c.textMuted }}>AI PROVIDER (FOR CUSTOM KEY)</label>
                 <div className="grid grid-cols-2 gap-2">
                   {([
                     { id: 'chatgpt' as ApiProvider, label: 'ChatGPT' },
                     { id: 'gemini' as ApiProvider, label: 'Gemini' },
                     { id: 'deepseek' as ApiProvider, label: 'DeepSeek' },
                     { id: 'grok' as ApiProvider, label: 'Grok' },
                   ]).map(p => (
                     <button
                       key={p.id}
                       onClick={() => setCustomProviderInput(p.id)}
                       className="py-2.5 rounded-xl border-2 font-bold text-xs transition-all"
                       style={{
                         backgroundColor: customProviderInput === p.id ? c.accentSubtle : c.bgTertiary,
                         borderColor: customProviderInput === p.id ? c.accent : c.borderPrimary,
                         color: customProviderInput === p.id ? c.accent : c.textSecondary,
                       }}
                     >
                       {customProviderInput === p.id && <Check size={10} className="inline mr-1" />}
                       {p.label}
                     </button>
                   ))}
                 </div>
              </div>
              <div className="space-y-2">
                 <label className="text-xs font-bold" style={{ color: c.textMuted }}>YOUR PERSONAL API KEY (OPTIONAL)</label>
                 <input type="password" value={customKeyInput} onChange={e => setCustomKeyInput(e.target.value)} placeholder="Paste your API key here..." className="w-full border p-4 rounded-xl outline-none text-sm" style={{ backgroundColor: c.bgInput, borderColor: c.borderPrimary, color: c.textPrimary }} />
                 <p className="text-[10px] italic" style={{ color: c.textMuted }}>If left blank, Utsho will use the shared community pool.</p>
              </div>
              <div className="flex gap-3">
                 <button onClick={() => setIsSettingsOpen(false)} className="flex-1 py-3 font-bold border rounded-xl transition-colors" style={{ borderColor: c.borderPrimary, color: c.textSecondary, backgroundColor: 'transparent' }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = c.bgTertiary)} onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>Cancel</button>
                 <button onClick={saveSettings} className="flex-1 py-3 font-bold rounded-xl transition-colors" style={{ backgroundColor: c.accent, color: '#fff', boxShadow: `0 4px 14px ${c.accentShadow}` }}>Save</button>
              </div>
           </div>
        </div>
      )}

      <aside className={`fixed md:relative z-50 inset-y-0 left-0 w-72 border-r flex flex-col transition-transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`} style={{ backgroundColor: c.bgSecondary, borderColor: c.borderPrimary }}>
        <div className="p-4 flex flex-col gap-4">
          <button onClick={() => createNewSession()} className="py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95" style={{ backgroundColor: c.buttonPrimary, color: c.buttonPrimaryText }}><Plus size={18} /> New Chat</button>
          
          {isAdmin ? (
          <div className="border rounded-[2rem] shadow-2xl space-y-4 p-4" style={{ backgroundColor: c.bgSecondary, borderColor: c.borderPrimary }}>
             <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: c.borderPrimary }}>
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest" style={{ color: c.textMuted }}>
                   POOL HEALTH
                </div>
                <button onClick={handleResetPool} className="transition-colors" style={{ color: c.textMuted }}><RefreshCcw size={12} /></button>
             </div>
             
             <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold" style={{ color: c.textMuted }}>AVAILABLE NODES</span>
                  <span className="text-[10px] font-black text-emerald-400">{poolInfo.active}/{poolInfo.total}</span>
                </div>
                <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: c.bgTertiary }}>
                  <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${(poolInfo.active / Math.max(1, poolInfo.total)) * 100}%` }} />
                </div>
             </div>

             <div className="pt-2 border-t" style={{ borderColor: c.borderPrimary }}>
                <div className="text-[9px] font-black text-center py-1 rounded-lg truncate" style={{ color: connectionHealth === 'error' ? '#f87171' : c.statusBarText, backgroundColor: connectionHealth === 'error' ? 'rgba(248,113,113,0.05)' : c.statusBar }}>
                  {apiStatusText.toUpperCase()} {isLoading && "..."}
                </div>
             </div>
          </div>
          ) : (
          <div className="border rounded-2xl p-3 flex items-center justify-center" style={{ backgroundColor: c.bgSecondary, borderColor: c.borderPrimary }}>
             <div className="text-[9px] font-black text-center py-1 rounded-lg truncate" style={{ color: connectionHealth === 'error' ? '#f87171' : c.statusBarText, backgroundColor: connectionHealth === 'error' ? 'rgba(248,113,113,0.05)' : c.statusBar, padding: '4px 12px' }}>
               {connectionHealth === 'error' ? 'RECONNECTING...' : 'ONLINE'} {isLoading && "..."}
             </div>
          </div>
          )}

          <div className="flex items-center justify-between px-3 py-2 rounded-xl border" style={{ backgroundColor: c.bgHover, borderColor: c.borderPrimary }}>
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: c.textMuted }}>Settings</span>
            <button onClick={() => setIsSettingsOpen(true)} className="transition-colors" style={{ color: c.textMuted }}><Settings size={14} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1 scrollbar-hide">
          {sessions.map(s => (
            <div key={s.id} onClick={() => { setActiveSessionId(s.id); if(window.innerWidth < 768) setIsSidebarOpen(false); }} className="group flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all border" style={{ backgroundColor: activeSessionId === s.id ? c.bgTertiary : 'transparent', color: activeSessionId === s.id ? c.textPrimary : c.textMuted, borderColor: activeSessionId === s.id ? c.borderSecondary : 'transparent', boxShadow: activeSessionId === s.id ? '0 4px 14px rgba(0,0,0,0.15)' : 'none' }}>
              <MessageSquare size={16} style={{ color: activeSessionId === s.id ? c.accent : undefined }} /> 
              <div className="flex-1 truncate text-sm font-medium">{s.title}</div>
              <button onClick={(e) => { e.stopPropagation(); db.deleteSession(userProfile!.email, s.id); setSessions(prev => prev.filter(x => x.id !== s.id)); }} className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t flex flex-col gap-3" style={{ borderColor: c.borderPrimary, backgroundColor: `${c.bgSecondary}cc` }}>
          <div className="flex items-center gap-3">
            <img src={userProfile?.picture} className="w-9 h-9 rounded-full border" style={{ borderColor: c.borderPrimary }} alt="" />
            <div className="flex-1 truncate text-[11px] font-bold leading-tight" style={{ color: c.textSecondary }}>
              {userProfile?.name} <br/> 
              <span className="text-[9px] uppercase tracking-widest font-black" style={{ color: c.textMuted }}>{userProfile?.age}Y &bull; {userProfile?.gender}</span>
            </div>
            <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="transition-colors hover:text-red-500" style={{ color: c.textMuted }}><LogOut size={16} /></button>
          </div>
          <div className="pt-2 border-t flex flex-col items-center gap-2 font-bold uppercase tracking-widest text-[9px]" style={{ borderColor: c.borderPrimary, color: c.textMuted }}>
            <div className="flex items-center gap-4">
              <a href="https://facebook.com/shakkhor12102005" target="_blank" className="transition-all hover:scale-110" style={{ color: c.textMuted }}><Facebook size={14}/></a>
              <a href="https://instagram.com/shakkhor_paul/" target="_blank" className="transition-all hover:scale-110" style={{ color: c.textMuted }}><Instagram size={14}/></a>
            </div>
            Developed by Shakkhor Paul
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <div className="md:hidden h-14 border-b backdrop-blur-md flex items-center px-4 sticky top-0 z-40" style={{ borderColor: c.borderPrimary, backgroundColor: `${c.bgPrimary}cc` }}>
          <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2" style={{ color: c.textSecondary }}><Menu size={20} /></button>
          <div className="flex-1 text-center font-black tracking-tighter text-lg" style={{ color: c.accent }}>UTSHO AI</div>
          <button onClick={() => createNewSession()} className="p-2" style={{ color: c.textSecondary }}><Plus size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-8 custom-scrollbar">
          <div className="max-w-3xl mx-auto space-y-6 pb-4">
            {!activeSession || activeSession.messages.length === 0 ? (
              <div className="h-[65vh] flex flex-col items-center justify-center space-y-6 text-center animate-in fade-in slide-in-from-top-8 duration-700">
                <div className="w-28 h-28 rounded-[2.5rem] flex items-center justify-center shadow-2xl floating-ai" style={{ backgroundColor: c.accent, boxShadow: `0 20px 40px ${c.accentShadow}` }}><Sparkles size={48} className="text-white" /></div>
                <div className="space-y-2 px-4">
                  <h3 className="text-3xl font-black tracking-tight" style={{ color: c.textPrimary }}>Hey {userProfile?.name.split(' ')[0]}!</h3>
                  <p className="text-sm max-w-xs mx-auto font-medium" style={{ color: c.textMuted }}>Fullstack Adaptive Identity Engaged. <br/> How can I help you today?</p>
                </div>
              </div>
            ) : (
              activeSession.messages.map(m => (
                <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-in slide-in-from-bottom-2 duration-300`}>
                   <div className={`flex flex-col gap-2 max-w-[90%] md:max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {m.documentName && (
                        <div className="flex items-center gap-2 border rounded-2xl px-3 py-2 mb-1" style={{ backgroundColor: c.bgTertiary, borderColor: c.borderPrimary }}>
                          <Paperclip size={14} style={{ color: c.accent }} />
                          <span className="text-xs font-bold truncate max-w-[200px]" style={{ color: c.textSecondary }}>{m.documentName}</span>
                        </div>
                      )}
                      {m.imageUrl && (
                        <div className="rounded-[2rem] overflow-hidden border shadow-2xl mb-1" style={{ borderColor: c.borderPrimary }}>
                           <img src={m.imageUrl} className="max-w-full h-auto max-h-[300px] object-cover" alt="User upload" />
                        </div>
                      )}
                      {m.content && (
                        <div 
                          className={`p-4 md:p-5 rounded-[2rem] text-[15px] bangla-text shadow-xl ${m.role === 'user' ? 'rounded-tr-none' : 'rounded-tl-none'}`} 
                          style={
                            m.content.startsWith("Failure") 
                              ? { backgroundColor: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.3)', border: '1px solid', color: '#f87171' }
                              : m.role === 'user' 
                                ? { backgroundColor: c.userBubble, boxShadow: `0 4px 14px ${c.userBubbleShadow}`, color: '#ffffff' }
                                : { backgroundColor: c.botBubble, border: `1px solid ${c.botBubbleBorder}`, color: c.textPrimary }
                          }
                        >
                          {m.content.startsWith("Failure") && <AlertCircle size={14} className="inline mr-2" />}
                          {m.content}
                        </div>
                      )}
                      {m.sources && m.sources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1 ml-1">
                          {m.sources.map((s: any, idx: number) => (
                            <a key={idx} href={s.uri} target="_blank" className="flex items-center gap-2 border py-1.5 px-3.5 rounded-2xl text-[10px] transition-all shadow-sm" style={{ backgroundColor: c.bgSecondary, borderColor: c.borderPrimary, color: c.textMuted }}>
                              <Globe size={10} style={{ color: c.accent }} /> <span className="max-w-[120px] truncate font-bold">{s.title}</span>
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

        <div className="p-4 md:p-8 backdrop-blur-xl border-t" style={{ backgroundColor: `${c.bgPrimary}e6`, borderColor: `${c.borderPrimary}80` }}>
          <div className="max-w-3xl mx-auto space-y-4">
            {imagePreview && (
              <div className="relative inline-block animate-in fade-in zoom-in duration-300">
                <img src={imagePreview} className="w-24 h-24 object-cover rounded-3xl border-2 shadow-2xl" style={{ borderColor: `${c.accent}66` }} alt="Preview" />
                <button onClick={() => { setSelectedImage(null); setImagePreview(null); }} className="absolute -top-2 -right-2 bg-red-500 text-white p-1.5 rounded-full shadow-lg hover:scale-110 transition-transform"><X size={14} /></button>
              </div>
            )}
            {selectedDocument && (
              <div className="relative inline-flex items-center gap-2 border rounded-2xl px-4 py-2.5 animate-in fade-in zoom-in duration-300" style={{ backgroundColor: c.bgTertiary, borderColor: c.borderPrimary }}>
                <Paperclip size={16} style={{ color: c.accent }} />
                <div className="text-sm">
                  <div className="font-bold truncate max-w-[200px]" style={{ color: c.textSecondary }}>{selectedDocument.fileName}</div>
                  <div className="text-[10px] uppercase font-bold" style={{ color: c.textMuted }}>{selectedDocument.fileType}</div>
                </div>
                <button onClick={() => setSelectedDocument(null)} className="ml-2 transition-colors hover:text-red-400" style={{ color: c.textMuted }}><X size={14} /></button>
              </div>
            )}
            <div className="flex items-end gap-2 border rounded-[2.5rem] p-2.5 shadow-2xl transition-all" style={{ backgroundColor: `${c.bgSecondary}cc`, borderColor: c.borderPrimary }}>
              <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
              <button onClick={() => fileInputRef.current?.click()} className="p-3.5 transition-colors" style={{ color: c.textMuted }}><Paperclip size={22} /></button>
              <textarea rows={1} value={inputText} onChange={e => { setInputText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder="Talk to Utsho..." className="flex-1 bg-transparent py-3.5 px-2 outline-none resize-none max-h-40 text-[15px]" style={{ color: c.textPrimary }} />
              <button onClick={handleSendMessage} disabled={isLoading} className="p-4 rounded-full transition-all active:scale-90 shadow-xl" style={{ backgroundColor: (inputText.trim() || selectedImage || selectedDocument) && !isLoading ? c.accent : c.bgTertiary, boxShadow: (inputText.trim() || selectedImage || selectedDocument) && !isLoading ? `0 4px 14px ${c.accentShadow}` : 'none', color: (inputText.trim() || selectedImage || selectedDocument) && !isLoading ? '#fff' : c.textMuted }}>
                 {isLoading ? <RefreshCcw size={22} className="animate-spin" /> : <Send size={22} />}
              </button>
            </div>
            <p className="text-[10px] text-center font-bold uppercase tracking-widest" style={{ color: c.textMuted }}>UTSHO CAN MAKE MISTAKES. CHECK IMPORTANT INFO.</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
