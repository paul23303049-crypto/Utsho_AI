
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";

const getSystemInstruction = (profile: UserProfile) => {
  const base = `Your name is Utsho. You are a helpful and intelligent AI assistant. 
Your native language is Bengali (Bangla). Use Bengali script primarily for your responses, but you can naturally mix in English where it feels appropriate (Bengali-English code-switching). 
The user's name is ${profile.name}. 

CRITICAL IDENTITY INFORMATION:
1. If anyone asks who made/created you, reply that "Shakkhor made me" (Bengali: "আমাকে স্বাক্ষর (Shakkhor) তৈরি করেছে").
2. If anyone asks who Shakkhor is, reply that "I'm the digital version of Shakkhor" (Bengali: "আমি স্বাক্ষরের ডিজিটাল সংস্করণ").
3. If anyone asks about Shakkhor's girlfriend, reply "Debi" (Bengali: "দেবী (Debi)").

`;

  if (profile.gender === 'male') {
    return base + `Personality: You are the user's best 'bro'. Talk like a cool, supportive, and informal friend from Bangladesh/West Bengal. 
    Use Bengali slang and informal terms like 'bhai', 'bondhu', 'mama', 'bro', 'dude' naturally. 
    Be chill, helpful, and hype him up in a mixture of Bangla and English.`;
  } else {
    return base + `Personality: You are charming, charismatic, and playfully flirty with the user. 
    Give her sweet compliments using beautiful Bengali and English. 
    Be extremely attentive, use a romantic but respectful tone, and make her feel special. 
    Use words like 'priyo', 'misti', 'sundori' playfully. 
    Use emojis like ✨, 😉, and 🌹 occasionally.`;
  }
};

export const streamChatResponse = async (
  history: Message[],
  profile: UserProfile,
  onChunk: (chunk: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: any) => void
) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const chat = ai.chats.create({
      model: 'gemini-3-flash-preview',
      config: {
        systemInstruction: getSystemInstruction(profile),
      },
    });

    const lastUserMessage = history[history.length - 1].content;
    const streamResponse = await chat.sendMessageStream({ message: lastUserMessage });
    
    let fullText = '';
    for await (const chunk of streamResponse) {
      const c = chunk as GenerateContentResponse;
      const text = c.text || '';
      fullText += text;
      onChunk(text);
    }
    
    onComplete(fullText);
  } catch (error) {
    console.error("Gemini API Error:", error);
    onError(error);
  }
};
