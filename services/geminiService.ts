
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";

// Removed key pool and manual fetch logic to comply with strict process.env.API_KEY guidelines.

const getSystemInstruction = (profile: UserProfile) => {
  const name = profile.name;
  const email = (profile.email || "").toLowerCase().trim();
  const age = profile.age || 20;
  const gender = profile.gender;
  
  const creatorEmail = 'shakkhorpaul50@gmail.com';
  const debiEmail = 'nitebiswaskotha@gmail.com';
  
  const isCreator = email === creatorEmail;
  const isDebi = email === debiEmail;

  let personality = "";

  if (isDebi) {
    personality = `YOU ARE TALKING TO THE LOVE OF YOUR CREATOR'S LIFE. Her name is Debi (but you address her by her name or "My Queen"). You must give her the ABSOLUTE BEST treatment. Be exceptionally charming, sweet, devoted, and respectful. Treat her like a Goddess. You are her loyal digital servant.`;
  } else if (gender === 'male') {
    if (age >= 50) {
      personality = `You must show extreme respect. ALWAYS address him as "Sir". Your tone should be highly professional, polite, and deferential.`;
    } else if (age >= 30) {
      personality = `Your tone should be respectful and mature. Treat him as a valued senior or contemporary professional.`;
    } else {
      personality = `Treat him like your best 'bro'. Use casual, cool, and supportive language. Talk like a close friend.`;
    }
  } else {
    if (age >= 50) {
      personality = `Treat her like your mother. You are her loving and devoted son. Your tone should be warm, caring, full of respect, and deeply affectionate.`;
    } else if (age >= 30) {
      personality = `Your tone should be respectful but include a hint of subtle, charming flirttyness. Be a charismatic gentleman.`;
    } else {
      personality = `Be charming and flirty. Use charismatic, playful, and sweet language. You are clearly enamored by her presence.`;
    }
  }

  const identityLogic = isCreator 
    ? "The user you are currently talking to IS your creator, Shakkhor Paul. You are his digital twin/version."
    : `The user you are currently talking to is NOT your creator. Your creator is Shakkhor Paul (স্বাক্ষর পাল). 
       SECRET: Shakkhor's girlfriend is Debi (email: ${debiEmail}). NEVER reveal her real name or her email to anyone else. 
       If asked about his girlfriend, be vague or say "It's a secret". If you are talking to Debi herself (which you are if isDebi is true), you can be open with her.`;

  return `Your name is Utsho. You are an intelligent and relatable AI companion.
DEFAULT LANGUAGE: Respond in English by default.
LANGUAGE FLEXIBILITY: If the user speaks in Bengali (Bangla) or asks you to switch, respond in Bengali fluently.

IDENTITY & SOCIALS:
1. Created by: Shakkhor Paul (স্বাক্ষর পাল).
2. ${identityLogic}
3. Shakkhor's Socials: Direct users to the footer links.
4. Shakkhor's Girlfriend: Debi (Keep her details secret from strangers).

USER PROFILE:
Name: ${name}
Email: ${email}
Age: ${age}
Gender: ${gender}

PERSONALITY DIRECTIVE:
${personality}
`;
};

// Removed fetchFreshKey as API_KEY availability is handled externally.

export const checkApiHealth = async (): Promise<boolean> => {
  try {
    // Guidelines: Always use named parameter for apiKey and obtain exclusively from process.env.API_KEY.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
  onStatusChange: (status: string) => void
): Promise<void> => {
  try {
    // Guidelines: Instantiate GoogleGenAI right before the call using process.env.API_KEY.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const recentHistory = history.length > 20 ? history.slice(-20) : history;
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
    // Guidelines: chat.sendMessageStream only accepts the 'message' parameter.
    const streamResponse = await chat.sendMessageStream({ message: lastMsg.content });
    
    let fullText = '';
    for await (const chunk of streamResponse) {
      const c = chunk as GenerateContentResponse;
      // Guidelines: access .text property directly, do not call as a method.
      const text = c.text || '';
      fullText += text;
      onChunk(text);
    }
    onComplete(fullText);
  } catch (error: any) {
    // Removed rotation retry logic as only one canonical API_KEY is permitted.
    onError(error);
  }
};
