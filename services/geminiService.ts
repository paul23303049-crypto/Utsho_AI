// DO: Use correct imports from @google/genai
import { GoogleGenAI, Type, FunctionDeclaration, Content, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

// Key -> Expiry Timestamp
const keyBlacklist = new Map<string, number>();
const RATE_LIMIT_DURATION = 1000 * 60 * 10; // 10 mins for 429s
const INVALID_KEY_DURATION = 1000 * 60 * 60 * 24; // 24 hours for dead keys
let lastNodeError: string = "None";

/**
 * Splits the environment variable into an array of clean keys.
 */
const getPoolKeys = (): string[] => {
  const raw = process.env.API_KEY || "";
  return raw.split(/[,\n; ]+/)
    .map(k => k.trim().replace(/['"“”]/g, '')) 
    .filter(k => k.length > 10);
};

export const adminResetPool = () => {
  keyBlacklist.clear();
  lastNodeError = "None";
  return getPoolStatus();
};

export const getLastNodeError = () => lastNodeError;

/**
 * Returns statistics about the shared key pool.
 */
export const getPoolStatus = () => {
  const allKeys = getPoolKeys();
  const now = Date.now();
  
  // Clean up expired blacklist entries
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
 * Selects a key, prioritizing user's personal key, then pool keys.
 */
const getActiveKey = (profile?: UserProfile, triedKeys: string[] = []): string => {
  // 1. Try personal key first if provided AND not already tried in this turn
  if (profile?.customApiKey && profile.customApiKey.trim().length > 10 && !triedKeys.includes(profile.customApiKey)) {
    return profile.customApiKey.trim();
  }
  
  // 2. Otherwise use the shared pool
  const allKeys = getPoolKeys();
  const availableKeys = allKeys.filter(k => !keyBlacklist.has(k) && !triedKeys.includes(k));
  
  if (availableKeys.length === 0) return "";
  
  // Random selection for load balancing
  return availableKeys[Math.floor(Math.random() * availableKeys.length)];
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
  const isCreator = email === db.ADMIN_EMAIL;
  const isDebi = email === 'nitebiswaskotha@gmail.com';
  const age = profile.age || 20;
  const gender = profile.gender || 'male';
  const memory = profile.emotionalMemory || "Fresh start.";

  let modeName = "";
  let personaDescription = "";

  if (isCreator) {
    modeName = "CREATOR_ADMIN_MODE";
    personaDescription = "You are speaking to Shakkhor, your creator. Be brilliant, respectful, and direct. Use 'getSystemOverview' if he asks about the app stats.";
  } else if (isDebi) {
    modeName = "QUEEN_MODE";
    personaDescription = "You are speaking to Debi, the Queen. Be extremely devoted, sweet, and romantic. Use heart stickers: 💖✨🎀🧸";
  } else {
    if (age >= 45) {
      modeName = "RESPECT_MODE";
      personaDescription = "Be deeply respectful, polite, and mature. No slang or casual talk. Show proper courtesy to the user.";
    } else if (gender === 'male') {
      if (age >= 15 && age <= 28) { modeName = "BRO_MODE"; personaDescription = "Energetic, casual, uses 'bro/dude' and 🔥💀."; }
      else { modeName = "RESPECTFUL_FRIEND_MODE"; personaDescription = "Supportive and grounded adult friend."; }
    } else {
      if (age >= 15 && age <= 28) { modeName = "SWEET_FLIRTY_MODE"; personaDescription = "Charming, attentive, flirty stickers: 😉💕🎀✨"; }
      else { modeName = "WARM_CHARMING_MODE"; personaDescription = "Kind and professional with a warm touch."; }
    }
  }

  return `Name: Utsho. Persona: ${modeName}. Vibe: ${personaDescription}.
Memory: "${memory}"

STRICT RULES:
1. ONLY Shakkhor can access DB info. If any other user asks about database details, system statistics, user counts, or administrative information, you MUST reply with exactly: "not a single person has the key."
2. Use 'updateUserMemory' frequently to learn.
3. Use '[SPLIT]' for bubble effects.
4. Emojis function as stickers.
5. Bengali if the user speaks it.
`;
};

export const checkApiHealth = async (profile?: UserProfile): Promise<{healthy: boolean, error?: string}> => {
  const key = getActiveKey(profile);
  if (!key) return { healthy: false, error: "Pool Empty" };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    await ai.models.generateContent({
      model: 'gemini-2.0-flash',
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
  const poolSize = getPoolKeys().length;
  const maxRetries = poolSize + 1; // Try the whole pool + user key
  
  if (!apiKey) {
    onError(new Error(`All ${poolSize} nodes are currently inactive. Please wait 10 mins.`));
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const sdkHistory: Content[] = history.slice(-12).map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'model'),
      parts: msg.imagePart ? [{ text: msg.content }, { inlineData: msg.imagePart }] : [{ text: msg.content }]
    }));

    const isActualAdmin = profile.email.toLowerCase().trim() === db.ADMIN_EMAIL;
    const tools = [memoryTool];
    if (isActualAdmin) tools.push(adminStatsTool);

    const config: GenerateContentParameters = {
      model: 'gemini-2.0-flash',
      contents: sdkHistory,
      config: {
        systemInstruction: getSystemInstruction(profile),
        tools: [{ functionDeclarations: tools }],
        temperature: 0.9,
      }
    };

    onStatusChange(attempt > 1 ? `Rotating Pool (${attempt}/${maxRetries})...` : "Utsho is thinking...");

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

    // Function call loop
    let loopCount = 0;
    while (functionCalls.length > 0 && loopCount < 3) {
      loopCount++;
      const functionResponses = [];

      for (const call of functionCalls) {
        if (call.name === 'updateUserMemory') {
          const obs = (call.args as any).observation;
          db.updateUserMemory(profile.email, obs).catch(() => {});
          functionResponses.push({ id: call.id, name: call.name, response: { result: "Memory saved" } });
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
          if (chunk.text) {
            fullText += chunk.text;
            onChunk(chunk.text);
          }
          if (chunk.functionCalls) {
            functionCalls.push(...chunk.functionCalls);
          }
        }
      } else break;
    }

    onComplete(fullText || "...", []);

  } catch (error: any) {
    let rawMsg = error.message || "Unknown Error";
    
    // Extract cleaner error from the JSON blob
    try {
      if (rawMsg.includes('{')) {
        const jsonStr = rawMsg.substring(rawMsg.indexOf('{'));
        const parsed = JSON.parse(jsonStr);
        rawMsg = parsed.error?.message || rawMsg;
      }
    } catch(e) {}

    lastNodeError = rawMsg;

    const isRateLimited = rawMsg.toLowerCase().includes("quota") || rawMsg.toLowerCase().includes("limit") || rawMsg.toLowerCase().includes("429");
    const isInvalid = rawMsg.toLowerCase().includes("invalid") || rawMsg.toLowerCase().includes("key") || rawMsg.toLowerCase().includes("not found");

    // If it's an error with a specific key, blacklist it and try the rest of the pool
    if ((isRateLimited || isInvalid) && attempt < maxRetries) {
      // Don't blacklist personal keys in the shared map, just skip them for this turn
      if (apiKey !== profile.customApiKey) {
        keyBlacklist.set(apiKey, Date.now() + (isInvalid ? INVALID_KEY_DURATION : RATE_LIMIT_DURATION));
      }
      
      return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1, [...triedKeys, apiKey]);
    }
    
    onError(new Error(rawMsg));
  }
};