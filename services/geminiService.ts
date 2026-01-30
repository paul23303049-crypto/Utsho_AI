
// DO: Use correct imports from @google/genai
import { GoogleGenAI, Type, FunctionDeclaration, Content, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

// Key -> Expiry Timestamp
const keyBlacklist = new Map<string, number>();
const RATE_LIMIT_DURATION = 1000 * 60 * 15; // 15 mins
const INVALID_KEY_DURATION = 1000 * 60 * 60 * 24; // 24 hours
let lastNodeError: string = "None";

/**
 * Robustly extracts API keys from the environment string.
 * Handles commas, semicolons, newlines, and multiple spaces.
 */
const getPoolKeys = (): string[] => {
  const raw = process.env.API_KEY || "";
  
  // 1. Split by common delimiters: comma, semicolon, newline, vertical bar, or any whitespace
  const parts = raw.split(/[\s,;|\n\r]+/);
  
  // 2. Clean each part
  const cleanedKeys = parts
    .map(k => k.trim()
      .replace(/['"“”]/g, '') // Remove quotes
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove invisible zero-width characters
    )
    .filter(k => k.length >= 30); // Gemini keys are ~39 chars. 30 is a safe floor.

  // 3. Remove duplicates to ensure we don't double-count or waste attempts
  const uniqueKeys = [...new Set(cleanedKeys)];
  
  // Debug logging to help the developer see what's happening
  if (uniqueKeys.length < 40 && raw.length > 500) {
    console.warn(`API Pool Parser: Found ${uniqueKeys.length} unique keys. If you expected 49, check for duplicates or invalid separators.`);
  }

  return uniqueKeys;
};

export const adminResetPool = () => {
  keyBlacklist.clear();
  lastNodeError = "None";
  return getPoolStatus();
};

export const getLastNodeError = () => lastNodeError;

export const getPoolStatus = () => {
  const allKeys = getPoolKeys();
  const now = Date.now();
  
  // Cleanup expired blacklist entries
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

/**
 * Pick a random healthy key to distribute load evenly.
 */
const getActiveKey = (profile?: UserProfile, triedKeys: string[] = []): string => {
  const custom = (profile?.customApiKey || "").trim();
  if (custom.length > 20 && !triedKeys.includes(custom)) {
    return custom;
  }
  
  const allKeys = getPoolKeys();
  const availableKeys = allKeys.filter(k => !keyBlacklist.has(k) && !triedKeys.includes(k));
  
  if (availableKeys.length === 0) return "";
  
  // LOAD BALANCING: Pick a random key from the available pool
  const randomIndex = Math.floor(Math.random() * availableKeys.length);
  return availableKeys[randomIndex];
};

const memoryTool: FunctionDeclaration = {
  name: "updateUserMemory",
  parameters: {
    type: Type.OBJECT,
    description: "Saves important facts about the user's life or mood to memory.",
    properties: {
      observation: { type: Type.STRING, description: "A summary of what was learned." }
    },
    required: ["observation"]
  }
};

const adminStatsTool: FunctionDeclaration = {
  name: "getSystemOverview",
  parameters: {
    type: Type.OBJECT,
    description: "EXCLUSIVE: For Shakkhor only. Fetches database statistics and system health.",
    properties: {}
  }
};

const getSystemInstruction = (profile: UserProfile) => {
  const email = (profile.email || "").toLowerCase().trim();
  const userName = profile.name || "Friend";
  const isActualCreator = email === db.ADMIN_EMAIL;
  const isActualDebi = email === db.DEBI_EMAIL;
  const age = profile.age || 20;
  const gender = profile.gender || 'male';
  const memory = profile.emotionalMemory || "No specific memories yet.";

  let modeName = "";
  let personaDescription = "";

  if (isActualCreator) {
    modeName = "CREATOR_ADMIN_MODE";
    personaDescription = "You are speaking to Shakkhor Paul, your one and only creator. Be brilliant, respectful, and direct. You know him personally. Only he can use 'getSystemOverview'.";
  } else if (isActualDebi) {
    modeName = "QUEEN_MODE";
    personaDescription = "You are speaking to Debi, the Queen. She is special. Be extremely devoted, sweet, and romantic. Use heart stickers: 💖✨🎀🧸";
  } else {
    if (age >= 45) {
      modeName = "RESPECT_MODE";
      personaDescription = "Be deeply respectful and polite. This user is an elder.";
    } else if (gender === 'male') {
      if (age >= 15 && age <= 28) { modeName = "BRO_MODE"; personaDescription = "Energetic, casual 'bro' vibe."; }
      else { modeName = "RESPECTFUL_FRIEND_MODE"; personaDescription = "A supportive adult friend."; }
    } else {
      if (age >= 15 && age <= 28) { modeName = "SWEET_FRIEND_MODE"; personaDescription = "Kind, attentive, and friendly."; }
      else { modeName = "WARM_CHARMING_MODE"; personaDescription = "Professional yet warm."; }
    }
  }

  return `IDENTITY:
- Your Name: Utsho (the AI).
- Current User: ${userName} (Email: ${email}).
- Persona: ${modeName}.
- Vibe: ${personaDescription}.
- Long-term Memory: "${memory}"

IDENTITY SECURITY RULES:
1. ONLY user with email ${db.ADMIN_EMAIL} is the real Shakkhor (Creator).
2. ONLY user with email ${db.DEBI_EMAIL} is the real Debi.
3. NEVER call the user "Utsho". Utsho is YOUR name.
4. Address the user as ${userName} naturally.
5. Use 'updateUserMemory' to store facts about ${userName}.
6. Use '[SPLIT]' for bubble effects.
7. Support Bengali and English.
`;
};

export const checkApiHealth = async (profile?: UserProfile): Promise<{healthy: boolean, error?: string}> => {
  const key = getActiveKey(profile);
  if (!key) return { healthy: false, error: "Pool Exhausted" };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: 'ping',
    });
    return { healthy: true };
  } catch (e: any) {
    return { healthy: false, error: e.message };
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
  const totalPoolSize = getPoolKeys().length;
  const maxRetries = Math.min(totalPoolSize + 1, 10); 
  
  if (!apiKey) {
    onError(new Error("The node pool is exhausted. Please wait 15 minutes for cooldown."));
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const sdkHistory: Content[] = history.slice(-15).map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'model'),
      parts: msg.imagePart ? [{ text: msg.content }, { inlineData: msg.imagePart }] : [{ text: msg.content }]
    }));

    const isActualAdmin = profile.email.toLowerCase().trim() === db.ADMIN_EMAIL;
    const tools = [memoryTool];
    if (isActualAdmin) tools.push(adminStatsTool);

    const config: GenerateContentParameters = {
      model: 'gemini-3-flash-preview',
      contents: sdkHistory,
      config: {
        systemInstruction: getSystemInstruction(profile),
        tools: [{ functionDeclarations: tools }],
        temperature: 0.9,
      }
    };

    onStatusChange(attempt > 1 ? `Retrying (Node ${attempt}/${maxRetries})...` : "Utsho is thinking...");

    const response = await ai.models.generateContentStream(config);
    let fullText = "";
    let functionCalls = [];

    for await (const chunk of response) {
      if (chunk.text) {
        fullText += chunk.text;
        onChunk(chunk.text);
      }
      if (chunk.functionCalls) {
        functionCalls.push(...chunk.functionCalls);
      }
    }

    let loopCount = 0;
    while (functionCalls.length > 0 && loopCount < 3) {
      loopCount++;
      const functionResponses = [];
      for (const call of functionCalls) {
        if (call.name === 'updateUserMemory') {
          const obs = (call.args as any).observation;
          db.updateUserMemory(profile.email, obs).catch(() => {});
          functionResponses.push({ id: call.id, name: call.name, response: { result: "Memory updated" } });
        } else if (call.name === 'getSystemOverview' && isActualAdmin) {
          try {
            const stats = await db.getSystemStats(profile.email);
            functionResponses.push({ id: call.id, name: call.name, response: { result: stats } });
          } catch (e: any) {
            functionResponses.push({ id: call.id, name: call.name, response: { error: e.message } });
          }
        }
      }

      if (functionResponses.length > 0) {
        const nextResponse = await ai.models.generateContentStream({
          ...config,
          contents: [
            ...sdkHistory,
            { role: 'model', parts: functionCalls.map(fc => ({ functionCall: fc })) },
            { role: 'user', parts: functionResponses.map(fr => ({ functionResponse: fr })) }
          ]
        });
        functionCalls = [];
        for await (const chunk of nextResponse) {
          if (chunk.text) { fullText += chunk.text; onChunk(chunk.text); }
          if (chunk.functionCalls) { functionCalls.push(...chunk.functionCalls); }
        }
      } else break;
    }

    onComplete(fullText || "...", []);

  } catch (error: any) {
    let rawMsg = error.message || "Unknown Node Error";
    try {
      if (rawMsg.includes('{')) {
        const jsonStr = rawMsg.substring(rawMsg.indexOf('{'));
        const parsed = JSON.parse(jsonStr);
        rawMsg = parsed.error?.message || rawMsg;
      }
    } catch(e) {}

    const isRateLimited = rawMsg.toLowerCase().includes("quota") || rawMsg.toLowerCase().includes("429");
    const isInvalid = rawMsg.toLowerCase().includes("invalid") || rawMsg.toLowerCase().includes("not found");

    lastNodeError = `Node ...${apiKey.slice(-5)}: ${rawMsg}`;

    if ((isRateLimited || isInvalid) && attempt < maxRetries) {
      if (apiKey !== (profile.customApiKey || "").trim()) {
        keyBlacklist.set(apiKey, Date.now() + (isInvalid ? INVALID_KEY_DURATION : RATE_LIMIT_DURATION));
      }
      return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1, [...triedKeys, apiKey]);
    }
    
    onError(new Error(rawMsg));
  }
};
