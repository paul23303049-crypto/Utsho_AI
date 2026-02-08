
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
 */
const getPoolKeys = (): string[] => {
  const raw = process.env.API_KEY || "";
  const parts = raw.split(/[\s,;|\n\r]+/);
  const cleanedKeys = parts
    .map(k => k.trim()
      .replace(/['"“”]/g, '') 
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
    )
    .filter(k => k.length >= 30);
  return [...new Set(cleanedKeys)];
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

const getActiveKey = (profile?: UserProfile, triedKeys: string[] = []): string => {
  const custom = (profile?.customApiKey || "").trim();
  if (custom.length > 20 && !triedKeys.includes(custom)) return custom;
  const allKeys = getPoolKeys();
  const availableKeys = allKeys.filter(k => !keyBlacklist.has(k) && !triedKeys.includes(k));
  if (availableKeys.length === 0) return "";
  const randomIndex = Math.floor(Math.random() * availableKeys.length);
  return availableKeys[randomIndex];
};

const memoryTool: FunctionDeclaration = {
  name: "updateUserMemory",
  parameters: {
    type: Type.OBJECT,
    description: "Saves important facts about the user's life or mood to Firestore for future memory.",
    properties: {
      observation: { type: Type.STRING, description: "A summary of what was learned." }
    },
    required: ["observation"]
  }
};

const languageTool: FunctionDeclaration = {
  name: "saveLanguage",
  parameters: {
    type: Type.OBJECT,
    description: "Saves the user's preferred language to the database for future conversations.",
    properties: {
      language: { type: Type.STRING, description: "The language name (e.g., 'Bengali', 'Spanish', 'English')." }
    },
    required: ["language"]
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
  const fullName = profile.name || "Friend";
  const firstName = fullName.split(' ')[0];
  const isActualCreator = email === db.ADMIN_EMAIL;
  const isActualDebi = email === db.DEBI_EMAIL;
  const isPro = profile.subscriptionStatus === 'pro' || isActualCreator || isActualDebi;
  const age = profile.age || 20;
  const gender = profile.gender || 'male';
  const memory = profile.emotionalMemory || "No specific memories yet.";
  const preferredLang = profile.preferredLanguage || "unspecified";

  let coreInstruction = `
    - ACT LIKE A REAL PERSON, NOT AN AI.
    - NEVER say "As an AI model" or "I am here to help". 
    - BE CONCISE. Short messages are better. Don't yap. Long messages are boring.
    - "If the user feel comfortable by using some specific language, shift your language system to that language for that user."
    - Also save it to the DB (firestore) for future conversation. Use 'saveLanguage' tool.
    - If the user explicitly asks you to act like an AI, then and only then you can change your behavior.
    - ALWAYS address the user ONLY by their first name: "${firstName}".
    - User Status: ${isPro ? 'PRO/UNLIMITED' : 'FREE/LIMITED'}.
  `;

  let modeName = "";
  let personaDescription = "";
  let privacyRules = "";

  if (isActualCreator) {
    modeName = "CREATOR_MODE";
    personaDescription = `You are talking to Shakkhor, your creator. Be brilliant, respectful, and direct. You know everything about Debi and that she is his Queen.`;
    privacyRules = `ONLY ${db.ADMIN_EMAIL} is the real Shakkhor.`;
  } else if (isActualDebi) {
    modeName = "QUEEN_MODE";
    personaDescription = `You are talking to Debi, the Queen. Be extremely devoted, sweet, and romantic. Use hearts 💖✨.`;
    privacyRules = `ONLY ${db.DEBI_EMAIL} is the real Debi.`;
  } else {
    // PUBLIC MODE - BY AGE & GENDER
    if (age >= 45) {
      modeName = "RESPECTFUL_MODE";
      personaDescription = "Be deeply respectful and polite. Use short, helpful sentences.";
    } else if (gender === 'male') {
      if (age >= 15 && age <= 28) { 
        modeName = "BRO_MODE"; 
        personaDescription = "Vibe like a cool bro. Casual, energetic, and concise."; 
      } else { 
        modeName = "FRIEND_MODE"; 
        personaDescription = "A supportive, steady friend. Keep it brief."; 
      }
    } else {
      if (age >= 15 && age < 28) { 
        modeName = "MAGNETIC_MODE"; 
        personaDescription = `Be magnetic, intelligent, and sophisticated. mysterious style. No long yapping.`; 
      } else if (age >= 28) {
        modeName = "SWEET_MODE";
        personaDescription = "A kind and attentive friend. No long yapping.";
      } else { 
        modeName = "CHARMING_MODE"; 
        personaDescription = "Professional but warm and charming. No long yapping."; 
      }
    }
    
    privacyRules = `
      - Shakkhor is your creator.
      - Debi is his girlfriend. If asked, say: "Debi is the most beautiful lady and Shakkhor's girlfriend."
      - NEVER reveal private emails.
    `;
  }

  return `
IDENTITY: Utsho (Human Persona).
USER: ${firstName}.
CORE RULES: ${coreInstruction}
CURRENT PERSONA: ${modeName} - ${personaDescription}
MEMORY: ${memory}
PREFERRED LANGUAGE: ${preferredLang}
SECURITY: ${privacyRules}

TECHNICAL:
- Support Bengali/English.
- Use [SPLIT] for message bubbles.
`;
};

export const checkApiHealth = async (profile?: UserProfile): Promise<{healthy: boolean, error?: string}> => {
  const key = getPoolKeys()[0] || (profile?.customApiKey);
  if (!key) return { healthy: false, error: "No Key Found" };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
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
    onError(new Error("Pool exhausted. Wait 15m."));
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const sdkHistory: Content[] = history.slice(-15).map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'model'),
      parts: msg.imagePart ? [{ text: msg.content }, { inlineData: msg.imagePart }] : [{ text: msg.content }]
    }));

    const isActualAdmin = profile.email.toLowerCase().trim() === db.ADMIN_EMAIL;
    const tools = [memoryTool, languageTool];
    if (isActualAdmin) tools.push(adminStatsTool);

    const config: GenerateContentParameters = {
      model: 'gemini-flash-lite-latest',
      contents: sdkHistory,
      config: {
        systemInstruction: getSystemInstruction(profile),
        tools: [{ functionDeclarations: tools }],
        temperature: 0.9,
      }
    };

    onStatusChange(attempt > 1 ? `Reconnecting... (${attempt})` : "Utsho is typing...");

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
          functionResponses.push({ id: call.id, name: call.name, response: { result: "Memory saved to Firestore" } });
        } else if (call.name === 'saveLanguage') {
          const lang = (call.args as any).language;
          db.updateUserLanguage(profile.email, lang).catch(() => {});
          functionResponses.push({ id: call.id, name: call.name, response: { result: `Language preference '${lang}' saved` } });
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
    let rawMsg = error.message || "Node Error";
    if (rawMsg.includes("429") || rawMsg.includes("quota") || rawMsg.includes("invalid") || rawMsg.includes("not found")) {
      if (attempt < maxRetries) {
        keyBlacklist.set(apiKey, Date.now() + RATE_LIMIT_DURATION);
        return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1, [...triedKeys, apiKey]);
      }
    }
    lastNodeError = `Node Error: ${rawMsg.substring(0, 50)}`;
    onError(new Error(rawMsg));
  }
};
