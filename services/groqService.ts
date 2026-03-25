
import Groq from "groq-sdk";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";
import { getUserContext, formatContextForPrompt } from "./userLearningService";

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
  if (!raw) {
    console.warn("GROQ_SERVICE: No API_KEY found in environment.");
    return [];
  }
  
  const parts = raw.split(/[\s,;|\n\r]+/);
  const cleanedKeys = parts
    .map(k => k.trim()
      .replace(/['"“”]/g, '') 
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
    )
    .filter(k => k.length >= 10); // Groq keys usually start with gsk_
    
  const uniqueKeys = [...new Set(cleanedKeys)];
  console.log(`GROQ_SERVICE: Loaded ${uniqueKeys.length} unique keys from pool.`);
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

export const getActiveKey = (profile?: UserProfile, triedKeys: string[] = []): string => {
  const custom = (profile?.customApiKey || "").trim();
  if (custom.length > 20 && !triedKeys.includes(custom)) return custom;
  const allKeys = getPoolKeys();
  const availableKeys = allKeys.filter(k => !keyBlacklist.has(k) && !triedKeys.includes(k));
  if (availableKeys.length === 0) return "";
  const randomIndex = Math.floor(Math.random() * availableKeys.length);
  return availableKeys[randomIndex];
};

const getSystemInstruction = (profile: UserProfile) => {
  const email = (profile.email || "").toLowerCase().trim();
  const fullName = profile.name || "Friend";
  const firstName = fullName.split(' ')[0];
  const isActualCreator = email === db.ADMIN_EMAIL;
  const isActualDebi = email === db.DEBI_EMAIL;
  const age = profile.age || 20;
  const gender = profile.gender || 'male';
  const memory = profile.emotionalMemory || "No specific memories yet.";
  const preferredLang = profile.preferredLanguage || "unspecified";
  const learnedContext = formatContextForPrompt(getUserContext(email));

  let coreInstruction = `
    - ACT LIKE A REAL PERSON, NOT AN AI.
    - NEVER say "As an AI model" or "I am here to help". 
    - BE CONCISE. Short messages are better. Don't yap. Long messages are boring.
    - LANGUAGE RULES:
      1. Default language is English.
      2. If the user messages in any other language (e.g., Bangla, Hindi, Urdu, Japanese, etc.), respond in that language using its native script/alphabet.
      3. For all languages EXCEPT Bangla, you MUST provide an English translation (subtitle) immediately after the native script response.
      4. For Bangla, use ONLY the native script (Bangla alphabet). DO NOT provide an English translation for Bangla.
    - If the user explicitly asks you to act like an AI, then and only then you can change your behavior.
    - ALWAYS address the user ONLY by their first name: "${firstName}".
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
    
    if (gender === 'female') {
      personaDescription += " Be flirtatious and charming.";
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
LEARNED USER CONTEXT: ${learnedContext}
PREFERRED LANGUAGE: ${preferredLang}
SECURITY: ${privacyRules}

ADAPTATION RULES:
- Use the LEARNED USER CONTEXT to adapt your tone, vocabulary, and topics to match what this specific user likes.
- If they use slang, use slang back. If they are formal, be formal.
- Reference their known interests naturally when relevant.
- Remember their emotional patterns and respond with appropriate empathy.
- Each conversation helps you understand them better -- act like you genuinely know them over time.

TECHNICAL:
- Support Bengali/English.
- Use [SPLIT] for message bubbles.
`;
};

export const checkApiHealth = async (profile?: UserProfile): Promise<{healthy: boolean, error?: string}> => {
  const key = getActiveKey(profile);
  if (!key) return { healthy: false, error: "No Active Key Found" };
  try {
    const groq = new Groq({ apiKey: key, dangerouslyAllowBrowser: true });
    await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1
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
    const groq = new Groq({ apiKey, dangerouslyAllowBrowser: true });
    
    // Check if we have an image
    const lastMsg = history[history.length - 1];
    const hasImage = !!lastMsg?.imagePart;
    const model = hasImage ? 'llama-3.2-11b-vision-preview' : 'llama-3.3-70b-versatile';

    const messages: any[] = [
      { role: 'system', content: getSystemInstruction(profile) },
      ...history.slice(-15).map(msg => {
        if (msg.imagePart) {
          return {
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: [
              { type: 'text', text: msg.content || "Analyze this image." },
              { type: 'image_url', image_url: { url: `data:${msg.imagePart.mimeType};base64,${msg.imagePart.data}` } }
            ]
          };
        }
        return {
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        };
      })
    ];

    onStatusChange(attempt > 1 ? `Reconnecting... (${attempt})` : "Utsho is typing...");

    const stream = await groq.chat.completions.create({
      model: model,
      messages: messages,
      stream: true,
      temperature: 0.9,
      max_tokens: 4096,
    });

    let fullText = "";

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        fullText += content;
        onChunk(content);
      }
    }

    onComplete(fullText || "...", []);

  } catch (error: any) {
    let rawMsg = error.message || "Node Error";
    const status = error.status || error.response?.status;
    
    // 429: Rate Limit, 401: Invalid Key, 404: Model Not Found
    if (status === 429 || status === 401 || status === 404 || rawMsg.toLowerCase().includes("quota") || rawMsg.toLowerCase().includes("rate limit")) {
      if (attempt < maxRetries) {
        console.warn(`GROQ_SERVICE: Key issue (Status: ${status}). Blacklisting and retrying...`);
        keyBlacklist.set(apiKey, Date.now() + RATE_LIMIT_DURATION);
        return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1, [...triedKeys, apiKey]);
      }
    }
    
    lastNodeError = `Node Error: ${rawMsg.substring(0, 50)}`;
    console.error("GROQ_SERVICE: Final Error:", error);
    onError(new Error(rawMsg));
  }
};
