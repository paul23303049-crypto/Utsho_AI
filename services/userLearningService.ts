
import OpenAI from "openai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

const LEARNING_STORAGE_PREFIX = "utsho_user_context_";
const ANALYSIS_COOLDOWN_PREFIX = "utsho_analysis_ts_";
const ANALYSIS_COOLDOWN_MS = 3 * 60 * 1000; // Analyze at most every 3 minutes per user
const MAX_CONTEXT_LENGTH = 4000; // Max chars for stored user context

export interface UserContext {
  interests: string[];
  communicationStyle: string;
  emotionalPatterns: string;
  topicsDiscussed: string[];
  preferences: string;
  personality: string;
  lastUpdated: string;
}

const DEFAULT_CONTEXT: UserContext = {
  interests: [],
  communicationStyle: "unknown",
  emotionalPatterns: "unknown",
  topicsDiscussed: [],
  preferences: "none noted yet",
  personality: "not yet determined",
  lastUpdated: new Date().toISOString(),
};

/**
 * Default service endpoint (encoded for security).
 */
const _ep = (): string => {
  const d = [104,116,116,112,115,58,47,47,97,112,105,46,103,114,111,113,46,99,111,109,47,111,112,101,110,97,105,47,118,49];
  return d.map(c => String.fromCharCode(c)).join('');
};

/**
 * Load stored user context from localStorage (fast) and optionally from Firebase.
 */
export const getUserContext = (email: string): UserContext => {
  const key = `${LEARNING_STORAGE_PREFIX}${email.toLowerCase().trim()}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      return JSON.parse(raw) as UserContext;
    }
  } catch {
    // corrupted, reset
  }
  return { ...DEFAULT_CONTEXT };
};

/**
 * Save user context to localStorage and Firebase.
 */
const saveUserContext = async (email: string, context: UserContext): Promise<void> => {
  const key = `${LEARNING_STORAGE_PREFIX}${email.toLowerCase().trim()}`;
  context.lastUpdated = new Date().toISOString();
  localStorage.setItem(key, JSON.stringify(context));

  // Also persist to Firebase as part of the user's emotional memory
  if (db.isDatabaseEnabled()) {
    const contextSummary = formatContextForMemory(context);
    try {
      await db.updateUserMemory(email, `[AUTO-LEARN] ${contextSummary}`);
    } catch (e) {
      console.warn("LEARNING_SERVICE: Failed to persist to Firebase:", e);
    }
  }
};

/**
 * Format the user context into a concise string for the system prompt.
 */
export const formatContextForPrompt = (context: UserContext): string => {
  const parts: string[] = [];

  if (context.interests.length > 0) {
    parts.push(`Interests: ${context.interests.slice(-10).join(", ")}`);
  }
  if (context.communicationStyle !== "unknown") {
    parts.push(`Communication style: ${context.communicationStyle}`);
  }
  if (context.emotionalPatterns !== "unknown") {
    parts.push(`Emotional patterns: ${context.emotionalPatterns}`);
  }
  if (context.topicsDiscussed.length > 0) {
    parts.push(`Recent topics: ${context.topicsDiscussed.slice(-8).join(", ")}`);
  }
  if (context.preferences !== "none noted yet") {
    parts.push(`Preferences: ${context.preferences}`);
  }
  if (context.personality !== "not yet determined") {
    parts.push(`Personality: ${context.personality}`);
  }

  return parts.length > 0
    ? parts.join(". ") + "."
    : "No user context learned yet. Pay attention to their style and interests.";
};

/**
 * Format context into a brief memory string for Firebase storage.
 */
const formatContextForMemory = (context: UserContext): string => {
  const parts: string[] = [];
  if (context.interests.length > 0) parts.push(`Interests: ${context.interests.slice(-5).join(", ")}`);
  if (context.communicationStyle !== "unknown") parts.push(`Style: ${context.communicationStyle}`);
  if (context.personality !== "not yet determined") parts.push(`Personality: ${context.personality}`);
  return parts.join(" | ") || "Learning in progress";
};

/**
 * Check if enough time has passed since last analysis for this user.
 */
const canAnalyze = (email: string): boolean => {
  const key = `${ANALYSIS_COOLDOWN_PREFIX}${email.toLowerCase().trim()}`;
  const lastTs = localStorage.getItem(key);
  if (!lastTs) return true;
  return Date.now() - parseInt(lastTs, 10) > ANALYSIS_COOLDOWN_MS;
};

/**
 * Mark that analysis was just performed.
 */
const markAnalyzed = (email: string): void => {
  const key = `${ANALYSIS_COOLDOWN_PREFIX}${email.toLowerCase().trim()}`;
  localStorage.setItem(key, Date.now().toString());
};

/**
 * Analyze recent conversation to learn about the user.
 * Uses the LLM itself to extract structured insights from the conversation.
 * This runs in the background after each AI response.
 */
export const analyzeConversation = async (
  recentMessages: Message[],
  profile: UserProfile,
  apiKey: string
): Promise<void> => {
  if (!apiKey || recentMessages.length < 2) return;
  if (!canAnalyze(profile.email)) return;

  markAnalyzed(profile.email);

  const existingContext = getUserContext(profile.email);

  // Take last 10 messages for analysis
  const messagesToAnalyze = recentMessages.slice(-10);
  const conversationText = messagesToAnalyze
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content.slice(0, 300)}`)
    .join("\n");

  const existingContextStr = JSON.stringify(existingContext, null, 0);

  try {
    const client = new OpenAI({ apiKey, baseURL: _ep(), dangerouslyAllowBrowser: true });

    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are a user behavior analyst. Given a conversation between a user and an AI, extract insights about the user. Return ONLY valid JSON with this exact structure:
{
  "interests": ["list", "of", "interests"],
  "communicationStyle": "brief description of how they communicate",
  "emotionalPatterns": "their emotional tendencies",
  "topicsDiscussed": ["recent", "topics"],
  "preferences": "what they seem to prefer",
  "personality": "brief personality assessment"
}

Merge with existing context where relevant. Keep each field concise (under 100 chars for strings, max 10 items for arrays). If you can't determine something, keep the existing value.`,
        },
        {
          role: "user",
          content: `Existing context: ${existingContextStr}

Recent conversation:
${conversationText}

Extract updated user insights as JSON:`,
        },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || "";

    // Extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<UserContext>;

      // Merge with existing context
      const merged: UserContext = {
        interests: mergeArrays(existingContext.interests, parsed.interests || []),
        communicationStyle:
          parsed.communicationStyle || existingContext.communicationStyle,
        emotionalPatterns:
          parsed.emotionalPatterns || existingContext.emotionalPatterns,
        topicsDiscussed: mergeArrays(
          existingContext.topicsDiscussed,
          parsed.topicsDiscussed || []
        ),
        preferences: parsed.preferences || existingContext.preferences,
        personality: parsed.personality || existingContext.personality,
        lastUpdated: new Date().toISOString(),
      };

      await saveUserContext(profile.email, merged);
      console.log("LEARNING_SERVICE: User context updated for", profile.email);
    }
  } catch (error) {
    // Silent fail -- learning is non-critical
    console.warn("LEARNING_SERVICE: Analysis failed (non-critical):", error);
  }
};

/**
 * Merge two string arrays, keeping unique items and capping at 15 items.
 */
const mergeArrays = (existing: string[], incoming: string[]): string[] => {
  const combined = [...existing];
  for (const item of incoming) {
    const normalized = item.toLowerCase().trim();
    if (normalized && !combined.some((e) => e.toLowerCase().trim() === normalized)) {
      combined.push(item.trim());
    }
  }
  // Keep last 15 items to prevent unbounded growth
  return combined.slice(-15);
};
