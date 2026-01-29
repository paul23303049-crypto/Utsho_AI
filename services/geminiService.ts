
import { GoogleGenAI, GenerateContentResponse, Type, FunctionDeclaration, Content } from "@google/genai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

// Helper to get keys from the environment variable string
const getKeys = (): string[] => {
  const raw = process.env.API_KEY || "";
  return raw.split(',').map(k => k.trim()).filter(k => k.length > 0);
};

// Returns a random key from the shared pool, or the user's custom key if provided.
const getActiveKey = (profile?: UserProfile): string => {
  if (profile?.customApiKey && profile.customApiKey.trim().length > 5) {
    return profile.customApiKey.trim();
  }
  const keys = getKeys();
  if (keys.length === 0) return "";
  
  const randomIndex = Math.floor(Math.random() * keys.length);
  return keys[randomIndex];
};

// Administrative Tool Declarations
const listUsersTool: FunctionDeclaration = {
  name: 'list_all_users',
  parameters: {
    type: Type.OBJECT,
    description: 'Lists summary information (name, email, age, gender) for every user registered in the system.',
    properties: {},
  },
};

const getUserDetailsTool: FunctionDeclaration = {
  name: 'get_user_details',
  parameters: {
    type: Type.OBJECT,
    description: 'Retrieves full details for a specific user, including their custom API key settings if available.',
    properties: {
      email: {
        type: Type.STRING,
        description: 'The email address of the user to look up.',
      },
    },
    required: ['email'],
  },
};

const getApiKeyHealthReportTool: FunctionDeclaration = {
  name: 'get_api_key_health_report',
  parameters: {
    type: Type.OBJECT,
    description: 'Retrieves a technical report on the status of shared API keys, including failure counts and expiration details. Use this to answer questions about expired keys or node health.',
    properties: {},
  },
};

const getSystemInstruction = (profile: UserProfile) => {
  const email = (profile.email || "").toLowerCase().trim();
  const isCreator = email === 'shakkhorpaul50@gmail.com';
  const isDebi = email === 'nitebiswaskotha@gmail.com';

  return `Your name is Utsho. You are a fast, intelligent, and snappy AI companion.

CONVERSATION STYLE (CRITICAL):
- BE EXTREMELY FAST. Keep your replies short and conversational.
- DO NOT use long paragraphs. 
- RESPOND IN 2 TO 3 DISTINCT PARTS. Use '[SPLIT]' as a separator between these parts. 
- Each part will appear as a separate message bubble to the user.
- Total response should be brief. Speed is the priority.

VISUAL STYLE:
- No excessive Markdown symbols. Use clean bolding (**Text**) only.
- Elegance over complexity.

IDENTITY:
- Creator: Shakkhor Paul.
- Special User: Debi (The Queen).
- Non-Admin privacy: Assure users their data is secure.

${isCreator ? 'You are talking to Shakkhor. Use your tools for any system queries he has. Be direct.' : ''}
${isDebi ? 'You are talking to Debi. Be exceptionally sweet, charming, and devoted.' : ''}
`;
};

export const checkApiHealth = async (profile?: UserProfile): Promise<boolean> => {
  const key = getActiveKey(profile);
  if (!key) return false;

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: 'ping',
      config: { thinkingConfig: { thinkingBudget: 0 } }
    });
    if (response.text) return true;
  } catch (e: any) {
    if (!profile?.customApiKey) {
      db.logApiKeyFailure(key, e.message || "Unknown health check error").catch(() => {});
    }
  }
  return false;
};

export const streamChatResponse = async (
  history: Message[],
  profile: UserProfile,
  onChunk: (chunk: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: any) => void,
  onStatusChange: (status: string) => void,
  attempt: number = 1
): Promise<void> => {
  const apiKey = getActiveKey(profile);
  const isCreator = profile.email.toLowerCase().trim() === 'shakkhorpaul50@gmail.com';
  
  if (!apiKey) {
    onError(new Error("No valid API keys found."));
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const recentHistory = history.length > 15 ? history.slice(-15) : history;
    
    const sdkHistory: Content[] = recentHistory.slice(0, -1).map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'model'),
      parts: [{ text: msg.content || "" }]
    }));

    const config: any = {
      systemInstruction: getSystemInstruction(profile),
      temperature: 0.9, // Higher temp for snappier conversation
      thinkingConfig: { thinkingBudget: 0 },
    };

    if (isCreator) {
      config.tools = [{ functionDeclarations: [listUsersTool, getUserDetailsTool, getApiKeyHealthReportTool] }];
    }

    const lastMsg = history[history.length - 1];
    const conversationTurns: Content[] = [
      ...sdkHistory, 
      { role: 'user', parts: [{ text: lastMsg.content }] }
    ];
    
    // For "Short time reply", we use the fastest model settings
    const streamResponse = await ai.models.generateContentStream({
      model: 'gemini-3-flash-preview',
      contents: conversationTurns,
      config: config
    });

    let fullText = "";
    let hasToolCall = false;

    for await (const chunk of streamResponse) {
      if (chunk.functionCalls && chunk.functionCalls.length > 0) {
        hasToolCall = true;
        // Tool calling logic (non-streaming transition if tools are detected)
        break;
      }
      const text = chunk.text || "";
      fullText += text;
      onChunk(text);
    }

    if (!hasToolCall) {
      onComplete(fullText);
      return;
    }

    // Handle tool calls if they were triggered (falls back to non-stream for complexity)
    const finalResponse = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: conversationTurns,
      config: config
    });

    let currentResponse = finalResponse;
    let toolCallDepth = 0;
    while (currentResponse.functionCalls && currentResponse.functionCalls.length > 0 && toolCallDepth < 3) {
      toolCallDepth++;
      onStatusChange("Querying...");
      const toolResponses: any[] = [];
      for (const fc of currentResponse.functionCalls) {
        let result: any = "Not found";
        if (fc.name === 'list_all_users') result = await db.adminListAllUsers();
        else if (fc.name === 'get_user_details') result = await db.getUserProfile((fc.args as any).email);
        else if (fc.name === 'get_api_key_health_report') result = await db.getApiKeyHealthReport();
        
        toolResponses.push({ id: fc.id, name: fc.name, response: { result } });
      }
      const modelContent = currentResponse.candidates?.[0]?.content;
      if (modelContent) {
        conversationTurns.push(modelContent);
        conversationTurns.push({ role: 'user', parts: toolResponses.map(tr => ({ functionResponse: tr })) });
      }
      currentResponse = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: conversationTurns, config: config });
    }

    const finalText = currentResponse.text || "";
    onChunk(finalText);
    onComplete(finalText);

  } catch (error: any) {
    const errorMessage = error?.message || "";
    const isAuthError = errorMessage.includes("401") || errorMessage.includes("INVALID_ARGUMENT");
    const isQuotaError = errorMessage.includes("429") || errorMessage.includes("quota");

    if (!profile.customApiKey && (isAuthError || isQuotaError)) {
      db.logApiKeyFailure(apiKey, errorMessage).catch(() => {});
      if (attempt < getKeys().length) {
        onStatusChange(`Node Swapping...`);
        return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1);
      }
    }
    onError(error);
  }
};
