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

const STABLE_HORDE_API = 'https://stablehorde.net/api/v2';
const STABLE_HORDE_ANON_KEY = '0000000000'; // Anonymous access key
const MAX_POLL_ATTEMPTS = 90; // Max ~3 minutes of polling (higher quality needs more time)
const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds
const IMAGE_MODELS = ['Deliberate', 'SDXL 1.0', 'stable_diffusion']; // Fallback chain

/**
 * Generates an image using Stable Horde (completely free, crowdsourced GPU network).
 * No API key required -- uses anonymous access.
 * Enforces a per-user daily limit of 5 images.
 * @param prompt The prompt for the image generation.
 * @param email The user's email for rate limiting.
 * @returns Image URL string, or null if failed.
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
    // Step 1: Submit async generation request to Stable Horde
    const submitResponse = await fetch(`${STABLE_HORDE_API}/generate/async`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': STABLE_HORDE_ANON_KEY,
      },
      body: JSON.stringify({
        prompt: prompt,
        params: {
          width: 768,
          height: 768,
          steps: 35,
          cfg_scale: 7.5,
          sampler_name: 'k_euler_a',
          post_processing: ['GFPGAN'],
        },
        nsfw: false,
        censor_nsfw: true,
        models: IMAGE_MODELS,
        r2: true,
      }),
    });

    if (!submitResponse.ok) {
      console.error("IMAGE_SERVICE: Stable Horde submit failed:", submitResponse.status);
      return null;
    }

    const submitData = await submitResponse.json();
    const jobId = submitData.id;

    if (!jobId) {
      console.error("IMAGE_SERVICE: No job ID returned from Stable Horde");
      return null;
    }

    console.log("IMAGE_SERVICE: Job submitted to Stable Horde:", jobId);

    // Step 2: Poll for completion
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      const statusResponse = await fetch(`${STABLE_HORDE_API}/generate/status/${jobId}`);
      if (!statusResponse.ok) continue;

      const statusData = await statusResponse.json();

      if (statusData.faulted) {
        console.error("IMAGE_SERVICE: Stable Horde job faulted");
        return null;
      }

      if (statusData.done && statusData.generations && statusData.generations.length > 0) {
        const imageUrl = statusData.generations[0].img;
        if (imageUrl) {
          // Track usage on success
          if (email) incrementImageUsage(email);
          console.log("IMAGE_SERVICE: Image generated successfully via Stable Horde");
          return imageUrl;
        }
      }

      // Still processing, continue polling
      if (statusData.queue_position !== undefined) {
        console.log(`IMAGE_SERVICE: Queue position: ${statusData.queue_position}, waiting: ${statusData.waiting}`);
      }
    }

    console.error("IMAGE_SERVICE: Stable Horde generation timed out");
    return null;
  } catch (error) {
    console.error("IMAGE_SERVICE: Error generating image:", error);
    return null;
  }
};
