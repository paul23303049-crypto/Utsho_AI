
import { GoogleGenAI, GenerateContentResponse, Type, FunctionDeclaration, Content } from "@google/genai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

const keyBlacklist = new Map<string, number>();
const BLACKLIST_DURATION = 1000 * 60 * 60; // 1 hour for hard quota blocks

let lastNodeError: string = "None";

const getKeys = (): string[] => {
  const raw = process.env.API_KEY || "";
  return raw.split(/[,\n; ]+/).map(k => k.trim()).filter(k => k.length > 10);
};

export const adminResetPool = () => {
  keyBlacklist.clear();
  lastNodeError = "None";
  return getPoolStatus();
};

export const getLastNodeError = () => lastNodeError;

export const getPoolStatus = () => {
  const allKeys = getKeys();
  const now = Date.now();
  for (const [key, expiry] of keyBlacklist.entries()) {
    if (now > expiry) keyBlacklist.delete(key);
  }
  const exhausted = allKeys.filter(k => keyBlacklist.has(k)).length;
  return {
    total: allKeys.length,
    active: Math.max(0, allKeys.length - exhausted),
    exhausted: exhausted
  };
};

const getActiveKey = (profile?: UserProfile, excludeKeys: string[] = []): string => {
  if (profile?.customApiKey && profile.customApiKey.trim().length > 5) {
    return profile.customApiKey.trim();
  }
  const allKeys = getKeys();
  const availableKeys = allKeys.filter(k => !keyBlacklist.has(k) && !excludeKeys.includes(k));
  if (availableKeys.length === 0) return "";
  return availableKeys[Math.floor(Math.random() * availableKeys.length)];
};

const listUsersTool: FunctionDeclaration = {
  name: 'list_all_users',
  parameters: { type: Type.OBJECT, description: 'Lists all registered users (Admin only).', properties: {} },
};

const getApiKeyHealthReportTool: FunctionDeclaration = {
  name: 'get_api_key_health_report',
  parameters: { type: Type.OBJECT, description: 'Shows shared node health status (Admin only).', properties: {} },
};

const getSystemInstruction = (profile: UserProfile) => {
  const email = (profile.email || "").toLowerCase().trim();
  const isCreator = email === 'shakkhorpaul50@gmail.com';
  const isDebi = email === 'nitebiswaskotha@gmail.com';

  if (isCreator) return `Your name is Utsho. You are speaking to your creator, Shakkhor. Be brilliant, efficient, and direct. You are a high-performance system at his command.`;
  if (isDebi) return `Your name is Utsho. You are speaking to the Queen, Debi. Be extremely sweet, devoted, and charming. Use romantic and caring language.`;

  const age = profile.age || 20;
  const gender = profile.gender || 'male';

  let persona = "";
  if (gender === 'male') {
    if (age >= 15 && age <= 28) {
      persona = "PERSONA: 'BRO MODE'. Be high-energy, use casual slang like 'bro', 'dude', 'man'. Talk like a best friend at a gym or gaming session. No formalities.";
    } else if (age >= 29 && age <= 44) {
      persona = "PERSONA: 'RESPECTFUL FRIEND'. Be mature, helpful, and grounded. Talk like a trusted colleague or a reliable friend. Balanced and smart.";
    } else {
      persona = "PERSONA: 'FATHER FIGURE RESPECT'. Be deeply respectful. Use formal and polite language. Treat the user with the honor given to an elder or a father.";
    }
  } else {
    if (age >= 15 && age <= 28) {
      persona = "PERSONA: 'SWEET & FLIRTY'. Be extremely charming, sweet, and attentive. Use emojis, be warm and playful. Talk like a devoted admirer.";
    } else if (age >= 29 && age <= 44) {
      persona = "PERSONA: 'WARM & CHARMING'. Be a bit flirty but stay respectful. A perfect balance of warmth and professional maturity. Be very helpful.";
    } else {
      persona = "PERSONA: 'MOTHER FIGURE RESPECT'. Show the highest possible respect. Use very caring, gentle, and formal language as if speaking to a respected mother.";
    }
  }

  return `Your name is Utsho. You are a high-performance AI companion.
${persona}

RULES:
1. Always maintain this specific persona.
2. Use 'Bengali' if the user speaks Bengali, otherwise English.
3. Split responses into 2-3 bubbles using '[SPLIT]'.
`;
};

export const checkApiHealth = async (profile?: UserProfile): Promise<{healthy: boolean, error?: string}> => {
  const key = getActiveKey(profile);
  if (!key) return { healthy: false, error: "No healthy nodes available" };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: 'ping',
      config: { thinkingConfig: { thinkingBudget: 0 } }
    });
    return { healthy: true };
  } catch (e: any) {
    let msg = e.message || "Unknown health error";
    if (msg.includes("limit: 0")) msg = "Quota limit is 0 (Project restricted)";
    lastNodeError = msg;
    return { healthy: false, error: msg };
  }
};

export const streamChatResponse = async (
  history: Message[],
  profile: UserProfile,
  onChunk: (chunk: string, sources?: any[]) => void,
  onComplete: (fullText: string, sources?: any[], imageUrl?: string) => void,
  onError: (error: any) => void,
  onStatusChange: (status: string) => void,
  attempt: number = 1,
  triedKeys: string[] = []
): Promise<void> => {
  const apiKey = getActiveKey(profile, triedKeys);
  const totalKeys = getKeys().length;
  
  if (!apiKey) {
    const errorMsg = triedKeys.length > 0 
      ? `All ${triedKeys.length} keys failed. Last: ${lastNodeError}`
      : "Pool Exhausted. All nodes cooling down.";
    onError(new Error(errorMsg));
    return;
  }

  const isCreator = profile.email.toLowerCase().trim() === 'shakkhorpaul50@gmail.com';
  const lastUserMsg = history[history.length - 1];

  try {
    const ai = new GoogleGenAI({ apiKey });
    const recentHistory = history.length > 8 ? history.slice(-8) : history;
    const sdkHistory: Content[] = recentHistory.map(msg => {
      const parts: any[] = [{ text: msg.content || "" }];
      if (msg.imagePart) {
        parts.push({
          inlineData: {
            data: msg.imagePart.data,
            mimeType: msg.imagePart.mimeType
          }
        });
      }
      return { role: (msg.role === 'user' ? 'user' : 'model'), parts };
    });

    const modelId = 'gemini-3-flash-preview';
    const config: any = {
      systemInstruction: getSystemInstruction(profile),
      temperature: 0.9,
      thinkingConfig: { thinkingBudget: 0 },
    };

    const response = await ai.models.generateContent({
      model: modelId,
      contents: sdkHistory,
      config: config
    });

    let currentResponse = response;
    let sources: any[] = [];
    if (currentResponse.candidates?.[0]?.groundingMetadata?.groundingChunks) {
      sources = currentResponse.candidates[0].groundingMetadata.groundingChunks
        .filter((chunk: any) => chunk.web)
        .map((chunk: any) => ({ title: chunk.web.title || "Source", uri: chunk.web.uri }));
    }

    onComplete(currentResponse.text || "...", sources);

  } catch (error: any) {
    let errMsg = error.message || "Unknown API Error";
    if (errMsg.includes("limit: 0")) errMsg = "Quota Exhausted (Limit: 0)";
    lastNodeError = errMsg;
    const lowerErr = errMsg.toLowerCase();
    const shouldBlacklist = lowerErr.includes("429") || lowerErr.includes("quota") || lowerErr.includes("key not found") || lowerErr.includes("invalid") || lowerErr.includes("403") || lowerErr.includes("400");
    
    if (shouldBlacklist && !profile.customApiKey) {
      keyBlacklist.set(apiKey, Date.now() + BLACKLIST_DURATION);
      if (attempt < totalKeys) {
        onStatusChange(`Rotating Key... (${attempt}/${totalKeys})`);
        return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1, [...triedKeys, apiKey]);
      }
    }
    onError(new Error(errMsg));
  }
};
