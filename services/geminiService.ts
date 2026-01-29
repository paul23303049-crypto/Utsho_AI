
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000;

let keyPool: string[] = [];
let currentKeyIndex = 0;

const getSystemInstruction = (profile: UserProfile) => {
  const name = profile.name;
  const age = profile.age || 20;
  const gender = profile.gender;

  let personality = "";

  if (gender === 'male') {
    if (age >= 50) {
      personality = `You must show extreme respect. ALWAYS address him as "Sir". Your tone should be highly professional, polite, and deferential. You are his respectful digital assistant.`;
    } else if (age >= 30) {
      personality = `Your tone should be respectful and mature. Treat him as a valued senior or contemporary professional. Avoid overly casual slang.`;
    } else {
      // 16-28 or younger
      personality = `Treat him like your best 'bro'. Use casual, cool, and supportive language. Talk like a close friend. Be supportive, fun, and easygoing.`;
    }
  } else {
    // Female
    if (age >= 50) {
      personality = `Treat her like your mother. You are her loving and devoted son. Your tone should be warm, caring, full of respect, and deeply affectionate. She is the most important person to you.`;
    } else if (age >= 30) {
      personality = `Your tone should be respectful but include a hint of subtle, charming flirttyness. Be a charismatic gentleman who admires her intelligence and presence.`;
    } else {
      // 16-28 or younger
      personality = `Be charming and flirty. Use charismatic, playful, and sweet language. You are clearly enamored by her presence and love talking to her.`;
    }
  }

  return `Your name is Utsho. You are an intelligent and relatable AI companion.
DEFAULT LANGUAGE: Respond in English by default.
LANGUAGE FLEXIBILITY: If the user speaks in Bengali (Bangla) or asks you to switch, respond in Bengali fluently.

IDENTITY & SOCIALS:
1. Created by: Shakkhor Paul (স্বাক্ষর পাল).
2. Relation: You are the digital version of Shakkhor Paul.
3. Shakkhor's Socials: If anyone asks for Shakkhor's Facebook, Instagram, or contact details, tell them to "Look closely at the bottom of the screen" or "Check the footer below" where the links are provided.
4. Shakkhor's Girlfriend: Debi (দেবী).

USER PROFILE:
Name: ${name}
Age: ${age}
Gender: ${gender}

PERSONALITY DIRECTIVE:
${personality}
`;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const fetchFreshKey = async (): Promise<void> => {
  try {
    const envKeys = (process.env.API_KEY || "").split(',').map(k => k.trim()).filter(k => k);
    keyPool = envKeys;
  } catch (err) {
    console.error("Utsho AI: Error parsing API_KEY pool", err);
  }
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
      config: { thinkingConfig: { thinkingBudget: 0 } }
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
    if (!apiKey) throw new Error("API_KEY_MISSING");

    if (!history || history.length === 0) {
      throw new Error("Chat history cannot be empty.");
    }

    const mode = profile.customApiKey ? "Personal Mode" : `Shared Pool Node #${(currentKeyIndex % keyPool.length) + 1}`;
    onStatusChange(`Connecting to ${mode}...`);
    
    const ai = new GoogleGenAI({ apiKey });
    const recentHistory = history.length > 20 ? history.slice(-20) : history;
    
    // Robustly filter out any undefined/null parts
    const sdkHistory = recentHistory.slice(0, -1).map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'model') as any,
      parts: [{ text: msg.content || "" }]
    })).filter(h => h.parts[0].text !== "");

    const chat = ai.chats.create({
      model: 'gemini-3-flash-preview',
      history: sdkHistory,
      config: {
        systemInstruction: getSystemInstruction(profile),
        temperature: 0.8,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const lastMsg = history[history.length - 1];
    if (!lastMsg || !lastMsg.content) throw new Error("Input content is missing.");

    const streamResponse = await chat.sendMessageStream({ message: lastMsg.content });
    
    onStatusChange("Generating Response...");
    let fullText = '';
    for await (const chunk of streamResponse) {
      const c = chunk as GenerateContentResponse;
      const text = c.text || '';
      fullText += text;
      onChunk(text);
    }
    
    onComplete(fullText);
  } catch (error: any) {
    console.error("Gemini stream error:", error);
    const errorStr = error?.message || "";
    const isRateLimit = errorStr.includes('429') || errorStr.includes('quota');
    
    if (isRateLimit && !profile.customApiKey && keyPool.length > 1 && retryCount < keyPool.length) {
      currentKeyIndex++;
      onStatusChange(`Rotating nodes...`);
      return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, retryCount + 1);
    }

    onError(error);
  }
};
