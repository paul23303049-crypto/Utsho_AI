
import OpenAI from "openai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

const LEARNING_STORAGE_PREFIX = "utsho_user_context_";
const ANALYSIS_COOLDOWN_PREFIX = "utsho_analysis_ts_";
const SELF_ASSESS_PREFIX = "utsho_selfassess_ts_";
const REFLECTION_PREFIX = "utsho_reflection_ts_";
const ANALYSIS_COOLDOWN_MS = 2 * 60 * 1000; // Analyze every 2 minutes per user
const SELF_ASSESS_COOLDOWN_MS = 60 * 1000; // Self-assess every 1 minute
const REFLECTION_COOLDOWN_MS = 30 * 60 * 1000; // Deep reflection every 30 minutes
const MAX_CONTEXT_LENGTH = 6000; // Max chars for stored user context

export interface UserContext {
  // Core user understanding
  interests: string[];
  communicationStyle: string;
  emotionalPatterns: string;
  topicsDiscussed: string[];
  preferences: string;
  personality: string;
  
  // Enhanced self-training fields
  responseRules: string[]; // Learned behavioral rules ("use short responses", "avoid emojis", etc.)
  currentMood: string; // Detected current emotional state
  engagementSignals: string; // What keeps this user engaged
  knowledgeAreas: string[]; // Topics user knows well
  learningInterests: string[]; // Topics user wants to learn about
  relationshipDepth: string; // How well the AI knows this user
  satisfactionScore: number; // 0-100, rolling satisfaction estimate
  conversationCount: number; // Total conversations analyzed
  selfImprovementNotes: string; // AI's notes on how to improve for this user
  
  lastUpdated: string;
}

const DEFAULT_CONTEXT: UserContext = {
  interests: [],
  communicationStyle: "unknown",
  emotionalPatterns: "unknown",
  topicsDiscussed: [],
  preferences: "none noted yet",
  personality: "not yet determined",
  responseRules: [],
  currentMood: "neutral",
  engagementSignals: "unknown",
  knowledgeAreas: [],
  learningInterests: [],
  relationshipDepth: "new acquaintance",
  satisfactionScore: 50,
  conversationCount: 0,
  selfImprovementNotes: "",
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
      const parsed = JSON.parse(raw);
      // Merge with defaults to handle missing fields from older versions
      return { ...DEFAULT_CONTEXT, ...parsed } as UserContext;
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
 * Format the user context into a comprehensive string for the system prompt.
 * This is the core of how the AI "remembers" and adapts to each user.
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
  
  // Enhanced context fields
  if (context.currentMood !== "neutral") {
    parts.push(`Current mood: ${context.currentMood}`);
  }
  if (context.engagementSignals !== "unknown") {
    parts.push(`Engagement drivers: ${context.engagementSignals}`);
  }
  if (context.knowledgeAreas.length > 0) {
    parts.push(`User is knowledgeable about: ${context.knowledgeAreas.slice(-8).join(", ")}`);
  }
  if (context.learningInterests.length > 0) {
    parts.push(`User wants to learn about: ${context.learningInterests.slice(-5).join(", ")}`);
  }
  if (context.relationshipDepth !== "new acquaintance") {
    parts.push(`Relationship: ${context.relationshipDepth}`);
  }
  if (context.responseRules.length > 0) {
    parts.push(`BEHAVIORAL RULES (follow these strictly): ${context.responseRules.slice(-10).join("; ")}`);
  }
  if (context.selfImprovementNotes) {
    parts.push(`Self-improvement notes: ${context.selfImprovementNotes}`);
  }

  return parts.length > 0
    ? parts.join(". ") + "."
    : "No user context learned yet. Pay close attention to their style, interests, and emotional cues.";
};

/**
 * Format context into a brief memory string for Firebase storage.
 */
const formatContextForMemory = (context: UserContext): string => {
  const parts: string[] = [];
  if (context.interests.length > 0) parts.push(`Interests: ${context.interests.slice(-5).join(", ")}`);
  if (context.communicationStyle !== "unknown") parts.push(`Style: ${context.communicationStyle}`);
  if (context.personality !== "not yet determined") parts.push(`Personality: ${context.personality}`);
  if (context.responseRules.length > 0) parts.push(`Rules: ${context.responseRules.slice(-3).join("; ")}`);
  if (context.satisfactionScore !== 50) parts.push(`Satisfaction: ${context.satisfactionScore}/100`);
  return parts.join(" | ") || "Learning in progress";
};

/**
 * Check if enough time has passed since last analysis for this user.
 */
const canRun = (prefix: string, email: string, cooldown: number): boolean => {
  const key = `${prefix}${email.toLowerCase().trim()}`;
  const lastTs = localStorage.getItem(key);
  if (!lastTs) return true;
  return Date.now() - parseInt(lastTs, 10) > cooldown;
};

/**
 * Mark that an operation was just performed.
 */
const markRun = (prefix: string, email: string): void => {
  const key = `${prefix}${email.toLowerCase().trim()}`;
  localStorage.setItem(key, Date.now().toString());
};

/**
 * Detect satisfaction signals from user messages.
 * Returns a score adjustment (-20 to +20) based on message patterns.
 */
const detectSatisfactionSignals = (messages: Message[]): number => {
  const userMessages = messages.filter(m => m.role === "user");
  if (userMessages.length < 2) return 0;
  
  let score = 0;
  
  for (const msg of userMessages) {
    const text = msg.content.toLowerCase();
    
    // Positive signals
    if (/\b(thanks|thank you|perfect|awesome|great|love it|exactly|haha|lol|lmao|nice|amazing|cool|wow)\b/.test(text)) score += 5;
    if (/[😂🤣😍❤️👍🔥💯😊🥰👏💖✨]/.test(msg.content)) score += 3;
    if (text.length > 50) score += 2; // Long messages = engaged
    
    // Negative signals
    if (/\b(no|wrong|not what|stop|shut up|annoying|boring|whatever|nah)\b/.test(text)) score -= 5;
    if (/\b(too long|too short|don't understand|confused|make sense)\b/.test(text)) score -= 3;
    if (text === "..." || text === "ok" || text === "k" || text === "hmm") score -= 2;
  }
  
  return Math.max(-20, Math.min(20, score));
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
  if (!canRun(ANALYSIS_COOLDOWN_PREFIX, profile.email, ANALYSIS_COOLDOWN_MS)) return;

  markRun(ANALYSIS_COOLDOWN_PREFIX, profile.email);

  const existingContext = getUserContext(profile.email);
  
  // Update satisfaction score from message signals
  const satisfactionDelta = detectSatisfactionSignals(recentMessages.slice(-6));
  existingContext.satisfactionScore = Math.max(0, Math.min(100, existingContext.satisfactionScore + satisfactionDelta));
  existingContext.conversationCount += 1;

  // Take last 12 messages for analysis
  const messagesToAnalyze = recentMessages.slice(-12);
  const conversationText = messagesToAnalyze
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content.slice(0, 400)}`)
    .join("\n");

  const existingContextStr = JSON.stringify({
    interests: existingContext.interests,
    communicationStyle: existingContext.communicationStyle,
    emotionalPatterns: existingContext.emotionalPatterns,
    topicsDiscussed: existingContext.topicsDiscussed,
    preferences: existingContext.preferences,
    personality: existingContext.personality,
    responseRules: existingContext.responseRules,
    currentMood: existingContext.currentMood,
    engagementSignals: existingContext.engagementSignals,
    knowledgeAreas: existingContext.knowledgeAreas,
    learningInterests: existingContext.learningInterests,
    relationshipDepth: existingContext.relationshipDepth,
    satisfactionScore: existingContext.satisfactionScore,
  }, null, 0);

  try {
    const client = new OpenAI({ apiKey, baseURL: _ep(), dangerouslyAllowBrowser: true });

    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are an advanced user behavior analyst and AI self-training system. Given a conversation between a user and an AI persona named "Utsho", extract deep insights about the user AND generate behavioral rules for how the AI should adapt.

Return ONLY valid JSON with this exact structure:
{
  "interests": ["list", "of", "interests"],
  "communicationStyle": "detailed description of how they communicate (formal/casual/slang/emoji-heavy/etc.)",
  "emotionalPatterns": "their emotional tendencies and triggers",
  "topicsDiscussed": ["recent", "topics"],
  "preferences": "response preferences (length, format, tone)",
  "personality": "brief personality assessment",
  "responseRules": ["specific behavioral rules for the AI, e.g. 'keep responses under 3 sentences', 'use bangla when they do', 'match their emoji usage level'"],
  "currentMood": "detected mood right now (happy/sad/frustrated/curious/playful/bored/etc.)",
  "engagementSignals": "what specifically engages this user (humor/depth/flirting/facts/stories/etc.)",
  "knowledgeAreas": ["topics", "user", "knows", "well"],
  "learningInterests": ["topics", "user", "wants", "to", "learn"],
  "relationshipDepth": "new acquaintance / getting to know / familiar / close friend / trusted confidant"
}

CRITICAL RULES FOR GENERATING responseRules:
- These are SELF-TRAINING instructions the AI will follow in future conversations
- Be SPECIFIC and ACTIONABLE (not vague like "be nice")
- Examples: "respond in Bangla when user writes in Bangla", "use max 2 emojis per message", "avoid formal language", "include humor in every response", "this user dislikes being asked too many questions"
- Update rules based on what WORKS (user engagement) and what DOESN'T (short/cold responses from user)
- Max 10 rules, prioritize the most impactful ones

Merge with existing context. Keep strings under 150 chars, arrays max 10 items. If unsure, keep existing values.`,
        },
        {
          role: "user",
          content: `Existing learned context: ${existingContextStr}

Recent conversation:
${conversationText}

Current satisfaction score: ${existingContext.satisfactionScore}/100
Conversation count: ${existingContext.conversationCount}

Extract updated user insights and self-training rules as JSON:`,
        },
      ],
      temperature: 0.3,
      max_tokens: 800,
    });

    const content = response.choices[0]?.message?.content || "";

    // Extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<UserContext>;

      // Merge with existing context
      const merged: UserContext = {
        interests: mergeArrays(existingContext.interests, parsed.interests || []),
        communicationStyle: parsed.communicationStyle || existingContext.communicationStyle,
        emotionalPatterns: parsed.emotionalPatterns || existingContext.emotionalPatterns,
        topicsDiscussed: mergeArrays(existingContext.topicsDiscussed, parsed.topicsDiscussed || []),
        preferences: parsed.preferences || existingContext.preferences,
        personality: parsed.personality || existingContext.personality,
        responseRules: mergeArrays(existingContext.responseRules, parsed.responseRules || [], 10),
        currentMood: parsed.currentMood || existingContext.currentMood,
        engagementSignals: parsed.engagementSignals || existingContext.engagementSignals,
        knowledgeAreas: mergeArrays(existingContext.knowledgeAreas, parsed.knowledgeAreas || []),
        learningInterests: mergeArrays(existingContext.learningInterests, parsed.learningInterests || []),
        relationshipDepth: parsed.relationshipDepth || existingContext.relationshipDepth,
        satisfactionScore: existingContext.satisfactionScore,
        conversationCount: existingContext.conversationCount,
        selfImprovementNotes: existingContext.selfImprovementNotes,
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
 * Self-assessment: AI evaluates the quality of its own last response
 * relative to what it knows about the user. Generates improvement notes.
 * Runs less frequently than analysis to conserve API calls.
 */
export const selfAssessResponse = async (
  recentMessages: Message[],
  profile: UserProfile,
  apiKey: string
): Promise<void> => {
  if (!apiKey || recentMessages.length < 4) return;
  if (!canRun(SELF_ASSESS_PREFIX, profile.email, SELF_ASSESS_COOLDOWN_MS)) return;

  markRun(SELF_ASSESS_PREFIX, profile.email);

  const context = getUserContext(profile.email);
  
  // Get the last exchange: user message + AI response + user reaction (if any)
  const lastMessages = recentMessages.slice(-4);
  const exchangeText = lastMessages
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content.slice(0, 500)}`)
    .join("\n");

  try {
    const client = new OpenAI({ apiKey, baseURL: _ep(), dangerouslyAllowBrowser: true });

    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are an AI self-improvement analyst. Evaluate how well the AI's response matched the user's needs and generate specific improvement notes.

Known user context:
- Communication style: ${context.communicationStyle}
- Preferences: ${context.preferences}
- Current mood: ${context.currentMood}
- Engagement signals: ${context.engagementSignals}
- Existing rules: ${context.responseRules.join("; ")}
- Satisfaction: ${context.satisfactionScore}/100

Return ONLY valid JSON:
{
  "responseQuality": "good/okay/poor",
  "whatWorked": "specific thing that worked well (or 'nothing notable')",
  "whatFailed": "specific issue (or 'nothing notable')",
  "newRule": "a new specific behavioral rule to add (or null if none needed)",
  "improvementNote": "brief note on what to do differently next time (max 150 chars)",
  "satisfactionAdjust": 0
}

satisfactionAdjust should be -10 to +10 based on how well the exchange went.
ONLY suggest a newRule if there's a clear, actionable pattern. Don't add vague rules.`,
        },
        {
          role: "user",
          content: `Recent exchange:\n${exchangeText}\n\nEvaluate the AI's performance:`,
        },
      ],
      temperature: 0.2,
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const assessment = JSON.parse(jsonMatch[0]);
      
      // Update context based on self-assessment
      if (assessment.newRule && typeof assessment.newRule === "string" && assessment.newRule !== "null") {
        context.responseRules = mergeArrays(context.responseRules, [assessment.newRule], 10);
      }
      
      if (assessment.improvementNote && assessment.improvementNote.length > 5) {
        context.selfImprovementNotes = assessment.improvementNote.slice(0, 150);
      }
      
      if (typeof assessment.satisfactionAdjust === "number") {
        context.satisfactionScore = Math.max(0, Math.min(100, 
          context.satisfactionScore + Math.max(-10, Math.min(10, assessment.satisfactionAdjust))
        ));
      }
      
      await saveUserContext(profile.email, context);
      console.log("LEARNING_SERVICE: Self-assessment complete for", profile.email, "- Quality:", assessment.responseQuality);
    }
  } catch (error) {
    console.warn("LEARNING_SERVICE: Self-assessment failed (non-critical):", error);
  }
};

/**
 * Deep reflection: Periodically synthesize all learned context into
 * a refined understanding. This is the AI "stepping back" to think
 * about what it's learned about the user holistically.
 */
export const deepReflection = async (
  profile: UserProfile,
  apiKey: string
): Promise<void> => {
  if (!apiKey) return;
  if (!canRun(REFLECTION_PREFIX, profile.email, REFLECTION_COOLDOWN_MS)) return;
  
  const context = getUserContext(profile.email);
  if (context.conversationCount < 3) return; // Need some data first
  
  markRun(REFLECTION_PREFIX, profile.email);

  try {
    const client = new OpenAI({ apiKey, baseURL: _ep(), dangerouslyAllowBrowser: true });

    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are performing a deep self-reflection on what you've learned about a user across multiple conversations. Synthesize all data into refined, actionable intelligence.

Your goal: Make the AI's future interactions feel like talking to someone who TRULY knows this person.

Return ONLY valid JSON:
{
  "refinedPersonality": "comprehensive personality profile (max 200 chars)",
  "refinedRules": ["top 5-7 most important behavioral rules, merged and deduplicated from existing ones"],
  "relationshipDepth": "updated relationship assessment",
  "selfImprovementNotes": "most important thing to improve (max 150 chars)",
  "engagementStrategy": "specific strategy for keeping this user engaged (max 150 chars)"
}`,
        },
        {
          role: "user",
          content: `Full user context to reflect on:
${JSON.stringify(context, null, 2)}

Synthesize and refine this into a deeper understanding:`,
        },
      ],
      temperature: 0.3,
      max_tokens: 600,
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const reflection = JSON.parse(jsonMatch[0]);
      
      if (reflection.refinedPersonality) {
        context.personality = reflection.refinedPersonality.slice(0, 200);
      }
      if (reflection.refinedRules && Array.isArray(reflection.refinedRules)) {
        // Replace rules entirely with refined versions
        context.responseRules = reflection.refinedRules.slice(0, 7).map((r: string) => r.slice(0, 150));
      }
      if (reflection.relationshipDepth) {
        context.relationshipDepth = reflection.relationshipDepth;
      }
      if (reflection.selfImprovementNotes) {
        context.selfImprovementNotes = reflection.selfImprovementNotes.slice(0, 150);
      }
      if (reflection.engagementStrategy) {
        context.engagementSignals = reflection.engagementStrategy.slice(0, 150);
      }
      
      await saveUserContext(profile.email, context);
      console.log("LEARNING_SERVICE: Deep reflection complete for", profile.email);
    }
  } catch (error) {
    console.warn("LEARNING_SERVICE: Deep reflection failed (non-critical):", error);
  }
};

/**
 * Merge two string arrays, keeping unique items and capping at a maximum.
 */
const mergeArrays = (existing: string[], incoming: string[], max: number = 15): string[] => {
  const combined = [...existing];
  for (const item of incoming) {
    const normalized = item.toLowerCase().trim();
    if (normalized && !combined.some((e) => e.toLowerCase().trim() === normalized)) {
      combined.push(item.trim());
    }
  }
  // Keep last N items to prevent unbounded growth
  return combined.slice(-max);
};
