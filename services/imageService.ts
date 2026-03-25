const DAILY_IMAGE_LIMIT = 5;
const STORAGE_KEY_PREFIX = 'utsho_img_usage_';

interface ImageUsage {
  date: string; // YYYY-MM-DD
  count: number;
}

/**
 * Returns today's date as a YYYY-MM-DD string.
 */
const getTodayKey = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * Gets the current image usage for a user today.
 */
const getUserImageUsage = (email: string): ImageUsage => {
  const key = `${STORAGE_KEY_PREFIX}${email.toLowerCase().trim()}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const usage: ImageUsage = JSON.parse(raw);
      if (usage.date === getTodayKey()) {
        return usage;
      }
    }
  } catch {
    // Corrupted data, reset
  }
  return { date: getTodayKey(), count: 0 };
};

/**
 * Increments the image generation count for a user today.
 */
const incrementImageUsage = (email: string): void => {
  const key = `${STORAGE_KEY_PREFIX}${email.toLowerCase().trim()}`;
  const usage = getUserImageUsage(email);
  usage.count += 1;
  localStorage.setItem(key, JSON.stringify(usage));
};

/**
 * Checks how many image generations a user has remaining today.
 * @returns The number of remaining generations (0 means limit reached).
 */
export const getRemainingImageGenerations = (email: string): number => {
  const usage = getUserImageUsage(email);
  return Math.max(0, DAILY_IMAGE_LIMIT - usage.count);
};

/**
 * Returns the daily image generation limit.
 */
export const getImageDailyLimit = (): number => DAILY_IMAGE_LIMIT;

/**
 * Generates an image using Pollinations.ai (Completely Free, No API Key).
 * Enforces a per-user daily limit of 5 images.
 * @param prompt The prompt for the image generation.
 * @param email The user's email for rate limiting.
 * @returns Base64 encoded image data, or null if failed, or an error string if rate limited.
 */
export const generateImage = async (prompt: string, email?: string): Promise<string | null> => {
  // Enforce rate limit if email is provided
  if (email) {
    const remaining = getRemainingImageGenerations(email);
    if (remaining <= 0) {
      return null;
    }
  }
  try {
    // Pollinations uses a simple URL structure: https://image.pollinations.ai/prompt/{prompt}
    // We add some parameters for better quality and consistency.
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&enhance=true&seed=${Math.floor(Math.random() * 1000000)}`;

    // We try to fetch the image and convert it to base64 for persistence
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error("Failed to fetch image from Pollinations");

      const blob = await response.blob();
      const result = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(imageUrl); // Fallback to URL if base64 conversion fails
        reader.readAsDataURL(blob);
      });

      // Track usage on success
      if (result && email) incrementImageUsage(email);
      return result;
    } catch (fetchError) {
      console.warn("IMAGE_SERVICE: Fetch failed, returning direct URL:", fetchError);
      // Track usage even for URL fallback (image was still generated)
      if (email) incrementImageUsage(email);
      return imageUrl; // Return direct URL if fetch/CORS fails
    }
  } catch (error) {
    console.error("IMAGE_SERVICE: Error generating image:", error);
    return null;
  }
};
