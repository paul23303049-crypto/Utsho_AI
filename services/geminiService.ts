
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

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
 * Sends a message using a fresh API instance every time.
 * This ensures that even if one connection 'expires' or hangs, the next one is clean.
 */
export const streamChatResponse = async (
  history: Message[],
  profile: UserProfile,
  onChunk: (chunk: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: any) => void,
  onStatusChange: (status: string) => void,
  retryCount = 0
): Promise<void> => {
  try {
    const apiKey = process.env.API_KEY;
    
    if (!apiKey || apiKey === 'undefined' || apiKey === '') {
      throw new Error("API_KEY_MISSING: The shared API key is not configured in the environment.");
    }

    // 1. FRESH CLIENT CREATION
    // We do NOT reuse a global 'ai' object. We create a new one to force a new session.
    onStatusChange(`Establishing Fresh Connection (Attempt ${retryCount + 1})...`);
    const ai = new GoogleGenAI({ apiKey });

    // 2. CONTEXT TRUNCATION
    // Keep history lean to prevent token overflow on free tier
    const recentHistory = history.length > 15 ? history.slice(-15) : history;

    const sdkHistory = recentHistory.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model' as any,
      parts: [{ text: msg.content }]
    }));

    // 3. MODEL INITIALIZATION
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
    
    onStatusChange("Receiving Data...");
    let fullText = '';
    for await (const chunk of streamResponse) {
      const c = chunk as GenerateContentResponse;
      const text = c.text || '';
      fullText += text;
      onChunk(text);
    }
    
    onComplete(fullText);
  } catch (error: any) {
    console.error(`[API ERROR] Attempt ${retryCount + 1}:`, error);

    const isRateLimit = error?.message?.includes('429');
    const isNetworkError = error?.message?.includes('fetch') || error?.message?.includes('Network');

    // 4. AUTO-RECOVERY LOGIC
    if ((isRateLimit || isNetworkError) && retryCount < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
      onStatusChange(`Connection unstable. Auto-refreshing in ${delay/1000}s...`);
      await sleep(delay);
      return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, retryCount + 1);
    }

    const friendlyError = isRateLimit 
      ? "The shared API is currently at its limit. Please wait a minute and try again."
      : "I'm having trouble connecting to the network. Please try again later.";
    
    onError(new Error(friendlyError));
  }
};
