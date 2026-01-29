
import { GoogleGenAI, GenerateContentResponse, Type, FunctionDeclaration, Content } from "@google/genai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

// Key blacklist to temporarily skip exhausted or invalid keys
const keyBlacklist = new Map<string, number>();
const BLACKLIST_DURATION = 1000 * 60 * 15; // 15 minutes for 429 errors

// Global diagnostic tracker for admin
let lastNodeError: string = "None";

const getKeys = (): string[] => {
  const raw = process.env.API_KEY || "";
  // Split by comma, newline, or semicolon to be extra robust
  return raw.split(/[,\n;]+/).map(k => k.trim()).filter(k => k.length > 5);
};

// Admin function to clear the blacklist
export const adminResetPool = () => {
  keyBlacklist.clear();
  lastNodeError = "None";
  return getPoolStatus();
};

export const getLastNodeError = () => lastNodeError;

// Returns stats about the pool for the UI
export const getPoolStatus = () => {
  const allKeys = getKeys();
  const now = Date.now();
  
  // Clean up expired blacklist items
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

// Returns an available key from the pool, prioritizing non-blacklisted ones.
const getActiveKey = (profile?: UserProfile, excludeKeys: string[] = []): string => {
  if (profile?.customApiKey && profile.customApiKey.trim().length > 5) {
    return profile.customApiKey.trim();
  }

  const allKeys = getKeys();
  const availableKeys = allKeys.filter(k => !keyBlacklist.has(k) && !excludeKeys.includes(k));
  
  if (availableKeys.length === 0) {
    return "";
  }

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

  const pool = getPoolStatus();
  const poolInfo = isCreator ? `\nCurrent System State: Using a pool of ${pool.total} API keys (${pool.active} currently healthy).` : '';

  return `Your name is Utsho. You are a high-performance AI companion.${poolInfo}

CAPABILITIES:
1. GOOGLE SEARCH: Use for current news, scores, and facts.
2. VISION: You can analyze images provided by the user.
3. MULTI-BUBBLE: Always split your responses into 2-3 snappy messages using '[SPLIT]'.

${isCreator ? 'You are speaking to your creator, Shakkhor. Be brilliant and efficient.' : ''}
${isDebi ? 'You are speaking to the Queen, Debi. Be sweet and devoted.' : ''}
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
    lastNodeError = e.message || "Unknown error during health check";
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
  const totalKeys = getKeys().length;
  
  if (!apiKey) {
    const errorMsg = triedKeys.length > 0 
      ? `Critical: All ${triedKeys.length} nodes returned errors. Last error: ${lastNodeError}`
      : "Pool Exhausted. All nodes are currently cooling down. Please wait or check your keys.";
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
      return {
        role: (msg.role === 'user' ? 'user' : 'model'),
        parts
      };
    });

    const isAdminCommand = isCreator && (lastUserMsg.content.toLowerCase().includes("list users") || lastUserMsg.content.toLowerCase().includes("health report"));
    const config: any = {
      systemInstruction: getSystemInstruction(profile),
      temperature: 0.7,
      thinkingConfig: { thinkingBudget: 0 },
    };

    if (isAdminCommand) config.tools = [{ functionDeclarations: [listUsersTool, getApiKeyHealthReportTool] }];
    else config.tools = [{ googleSearch: {} }];

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
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

    if (currentResponse.functionCalls && currentResponse.functionCalls.length > 0) {
      onStatusChange("Admin Access...");
      const toolResponses: any[] = [];
      for (const fc of currentResponse.functionCalls) {
        let result: any = "Restricted";
        if (fc.name === 'list_all_users') result = await db.adminListAllUsers();
        if (fc.name === 'get_api_key_health_report') result = await db.getApiKeyHealthReport();
        toolResponses.push({ id: fc.id, name: fc.name, response: { result } });
      }
      
      const modelContent = currentResponse.candidates?.[0]?.content;
      if (modelContent) {
        sdkHistory.push(modelContent);
        sdkHistory.push({ role: 'user', parts: toolResponses.map(tr => ({ functionResponse: tr })) });
        currentResponse = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: sdkHistory, config: config });
      }
    }

    onComplete(currentResponse.text || "...", sources);

  } catch (error: any) {
    const errMsg = (error.message || "").toLowerCase();
    lastNodeError = error.message || "Unknown error";
    
    // Blacklist for errors that suggest the node shouldn't be used again soon
    const shouldBlacklist = errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("key not found") || errMsg.includes("invalid") || errMsg.includes("403") || errMsg.includes("400");
    
    if (shouldBlacklist && !profile.customApiKey) {
      keyBlacklist.set(apiKey, Date.now() + BLACKLIST_DURATION);
      console.warn(`Node ${attempt} failed: ${error.message}. Swapping...`);
      
      if (attempt < totalKeys) {
        onStatusChange(`Node Swap (${attempt}/${totalKeys})...`);
        return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1, [...triedKeys, apiKey]);
      }
    }
    
    onError(error);
  }
};
