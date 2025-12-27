
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000;

let keyPool: string[] = [];
let currentKeyIndex = 0;

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
    return base + `Personality: You are the user's best 'bro'. Talk like a cool, supportive, and informal friend from Bangladesh/West Bengal.`;
  } else {
    return base + `Personality: You are charming, charismatic, and playfully flirty with the user.`;
  }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const fetchFreshKey = async (): Promise<void> => {
  // Initialize Key Pool from Environment
  // Support comma separated keys: "KEY1,KEY2,KEY3"
  const envKeys = (process.env.API_KEY || "").split(',').map(k => k.trim()).filter(k => k);
  keyPool = envKeys;
};

const getActiveKey = (profile?: UserProfile): string => {
  if (profile?.customApiKey) return profile.customApiKey;
  if (keyPool.length === 0) return "";
  return keyPool[currentKeyIndex % keyPool.length];
};

export const checkApiHealth = async (customKey?: string): Promise<boolean> => {
  try {
    const apiKey = customKey || getActiveKey();
    if (!apiKey) return false;
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: 'ping',
    });
    return !!response.text;
  } catch (e) {
    return false;
  }
};

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
    const apiKey = getActiveKey(profile);
    
    if (!apiKey) {
      throw new Error("API_KEY_MISSING: Shared pool is empty. Please set API_KEY in environment.");
    }

    const mode = profile.customApiKey ? "Personal Mode" : `Shared Node #${(currentKeyIndex % keyPool.length) + 1}`;
    onStatusChange(`Connecting to ${mode}...`);
    
    const ai = new GoogleGenAI({ apiKey });
    const recentHistory = history.length > 15 ? history.slice(-15) : history;
    const sdkHistory = recentHistory.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model' as any,
      parts: [{ text: msg.content }]
    }));

    const chat = ai.chats.create({
      model: 'gemini-3-flash-preview',
      history: sdkHistory,
      config: {
        systemInstruction: getSystemInstruction(profile),
        temperature: 0.8,
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
    const errorStr = error?.message || "";
    const isRateLimit = errorStr.includes('429') || errorStr.includes('quota');
    
    // If we hit a rate limit on a shared key, rotate to the next one
    if (isRateLimit && !profile.customApiKey && keyPool.length > 1) {
      currentKeyIndex++;
      onStatusChange(`Node Busy. Rotating to Node #${(currentKeyIndex % keyPool.length) + 1}...`);
      await sleep(500);
      return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, retryCount);
    }

    // Standard exponential backoff for other errors
    if (isRateLimit && retryCount < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
      onStatusChange(`Rate Limited. Retrying in ${delay/1000}s...`);
      await sleep(delay);
      return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, retryCount + 1);
    }

    onError(error);
  }
};
