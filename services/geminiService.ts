
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1500; // 1.5 seconds

const getSystemInstruction = (profile: UserProfile) => {
  const base = `Your name is Utsho. You are a helpful and intelligent AI assistant. 
Your native language is Bengali (Bangla). Use Bengali script primarily for your responses, but you can naturally mix in English where it feels appropriate (Bengali-English code-switching). 
The user's name is ${profile.name}. 

CRITICAL IDENTITY INFORMATION:
1. If anyone asks who made/created you, reply that "Shakkhor Paul made me" (Bengali: "আমাকে স্বাক্ষর পাল (Shakkhor Paul) তৈরি করেছে").
2. If anyone asks who Shakkhor Paul is, reply that "I'm the digital version of Shakkhor Paul" (Bengali: "আমি স্বাক্ষর পালের ডিজিটাল সংস্করণ").
3. If anyone asks about Shakkhor Paul's girlfriend, reply "Debi" (Bengali: "দেবী (Debi)").

`;

  if (profile.gender === 'male') {
    return base + `Personality: You are the user's best 'bro'. Talk like a cool, supportive, and informal friend from Bangladesh/West Bengal. 
    Use Bengali slang and informal terms like 'bhai', 'bondhu', 'mama', 'bro', 'dude' naturally. 
    Be chill, helpful, and hype him up in a mixture of Bangla and English.`;
  } else {
    return base + `Personality: You are charming, charismatic, and playfully flirty with the user. 
    Give her sweet compliments using beautiful Bengali and English. 
    Be extremely attentive, use a romantic but respectful tone, and make her feel special. 
    Use words like 'priyo', 'misti', 'sundori' playfully. 
    Use emojis like ✨, 😉, and 🌹 occasionally.`;
  }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Streams response from Gemini. 
 * Recreates the AI instance on every call to ensure fresh connection state.
 * Implements retries for the free tier.
 */
export const streamChatResponse = async (
  history: Message[],
  profile: UserProfile,
  onChunk: (chunk: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: any) => void,
  retryCount = 0
): Promise<void> => {
  try {
    // Accessing the key injected by Vite/Cloudflare
    const apiKey = process.env.API_KEY;
    
    if (!apiKey || apiKey === 'undefined' || apiKey === '') {
      throw new Error("API_KEY_MISSING: Please set the API_KEY in your Cloudflare Pages environment variables.");
    }

    // 1. RECREATE: Every request gets a brand new instance of the SDK
    const ai = new GoogleGenAI({ apiKey });

    // 2. CONTEXT MANAGEMENT: Keep last 15 messages to stay within free tier token limits
    const contextHistory = history.length > 15 ? history.slice(-15) : history;

    // Convert history to Gemini SDK format
    const sdkHistory = contextHistory.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model' as any,
      parts: [{ text: msg.content }]
    }));

    const chat = ai.chats.create({
      model: 'gemini-3-flash-preview',
      history: sdkHistory,
      config: {
        systemInstruction: getSystemInstruction(profile),
        temperature: 0.85,
        topP: 0.95,
      },
    });

    const lastUserMessage = history[history.length - 1].content;
    const streamResponse = await chat.sendMessageStream({ message: lastUserMessage });
    
    let fullText = '';
    for await (const chunk of streamResponse) {
      const c = chunk as GenerateContentResponse;
      const text = c.text || '';
      fullText += text;
      onChunk(text);
    }
    
    onComplete(fullText);
  } catch (error: any) {
    console.error(`Attempt ${retryCount + 1} failed:`, error);

    // 3. RETRY LOGIC: If the free API "expires" (rate limit) or flickers, recreate and retry
    const isRateLimit = error?.message?.includes('429');
    const isServerError = error?.message?.includes('500') || error?.message?.includes('503');
    const isNetworkError = error?.message?.toLowerCase().includes('fetch') || error?.message?.toLowerCase().includes('network');

    if ((isRateLimit || isServerError || isNetworkError) && retryCount < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount); // 1.5s, 3s, 6s...
      
      // Notify the UI that we are "recreating" the connection
      onChunk(`\n\n*(The free API is busy. Reconnecting... attempt ${retryCount + 1}/${MAX_RETRIES})*\n\n`);
      
      await sleep(delay);
      return streamChatResponse(history, profile, onChunk, onComplete, onError, retryCount + 1);
    }

    // Final failure handling
    let userFriendlyMessage = error?.message || "An unexpected error occurred.";
    if (isRateLimit) {
      userFriendlyMessage = "The shared free API is temporarily overloaded. Please wait a minute and try again.";
    } else if (error?.message?.includes('API_KEY_MISSING')) {
      userFriendlyMessage = "Setup incomplete: API_KEY not found. If this is Cloudflare, please check your environment variables.";
    }

    onError(new Error(userFriendlyMessage));
  }
};
