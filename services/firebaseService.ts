
import { initializeApp, getApp, getApps } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  deleteDoc,
  increment,
  Timestamp,
  Firestore,
  getCountFromServer
} from 'firebase/firestore';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  Auth 
} from 'firebase/auth';
import { UserProfile, ChatSession, Message, ApiKeyHealth } from '../types';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

export const ADMIN_EMAIL = 'shakkhorpaul50@gmail.com';
const DEBI_EMAIL = 'nitebiswaskotha@gmail.com';

const isConfigValid = !!firebaseConfig.apiKey && !!firebaseConfig.projectId;

let db: Firestore | null = null;
let auth: Auth | null = null;

if (isConfigValid) {
  try {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (err) {
    console.error("Firebase initialization failed:", err);
  }
}

export const isDatabaseEnabled = () => !!db;
export const isAdmin = (email: string) => email.toLowerCase().trim() === ADMIN_EMAIL;
export const isDebi = (email: string) => email.toLowerCase().trim() === DEBI_EMAIL;

/**
 * Fetches system statistics. Restricted to Shakkhor only.
 * If this fails with "Missing or insufficient permissions", 
 * the Firestore Rules in the Firebase Console must be updated.
 */
export const getSystemStats = async (requesterEmail: string) => {
  if (!db) return { error: "Database offline" };
  
  const normalizedRequester = requesterEmail.toLowerCase().trim();
  if (normalizedRequester !== ADMIN_EMAIL) {
    throw new Error("Access Denied: You are not Shakkhor.");
  }

  try {
    // 1. Get User Count (Requires 'read' on 'users' collection)
    const usersCollection = collection(db, 'users');
    const userCountSnap = await getCountFromServer(usersCollection);
    const totalUsers = userCountSnap.data().count;
    
    // 2. Get API Health (Requires 'read' on 'system/api_health/keys' collection)
    const healthRef = collection(db, 'system', 'api_health', 'keys');
    const healthSnap = await getDocs(healthRef);
    const healthData = healthSnap.docs.map(d => d.data());
    
    return {
      totalUsers,
      activeKeysReport: healthData.length > 0 
        ? healthData.map(d => `${d.keyId}: ${d.status}`).join(', ') 
        : "No keys registered in health logs.",
      timestamp: new Date().toLocaleString(),
      adminVerified: true,
      dbStatus: "Connected & Authorized"
    };
  } catch (err: any) {
    console.error("Firestore Admin Permission Error:", err);
    // This message is passed back to the AI to show to the admin
    throw new Error(`Firestore Error: ${err.message}. Please ensure the 'MASTER ADMIN OVERRIDE' rule is published in the Firebase Console.`);
  }
};

export const loginWithGoogle = async (): Promise<UserProfile | null> => {
  if (!auth) throw new Error("Auth not initialized");
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const user = result.user;

  if (user && user.email) {
    return {
      name: user.displayName || 'User',
      email: user.email.toLowerCase(),
      picture: user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=4f46e5&color=fff`,
      gender: 'male', 
      age: 0,        
      googleId: user.uid
    };
  }
  return null;
};

export const saveUserProfile = async (profile: UserProfile) => {
  if (!db || !profile.email) return;
  const userRef = doc(db, 'users', profile.email.toLowerCase());
  await setDoc(userRef, {
    name: profile.name,
    email: profile.email.toLowerCase(),
    gender: profile.gender,
    age: profile.age,
    picture: profile.picture,
    googleId: profile.googleId || '',
    customApiKey: profile.customApiKey || '',
    emotionalMemory: profile.emotionalMemory || ''
  }, { merge: true });
};

export const updateUserMemory = async (email: string, memoryUpdate: string) => {
  if (!db || !email) return;
  const emailLower = email.toLowerCase();
  const userRef = doc(doc(db, 'users', emailLower), 'private', 'memory'); 
  const snap = await getDoc(userRef);
  let existingMemory = "";
  if (snap.exists()) {
    existingMemory = snap.data().emotionalMemory || "";
  }
  const newMemory = `${existingMemory}\n[${new Date().toLocaleDateString()}]: ${memoryUpdate}`.slice(-3000); 
  await setDoc(userRef, { emotionalMemory: newMemory }, { merge: true });
  await setDoc(doc(db, 'users', emailLower), { emotionalMemory: newMemory }, { merge: true });
  return newMemory;
};

export const getUserProfile = async (email: string): Promise<UserProfile | null> => {
  if (!db) return null;
  const userRef = doc(db, 'users', email.toLowerCase());
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) return userSnap.data() as UserProfile;
  return null;
};

export const logApiKeyFailure = async (key: string, errorMessage: string) => {
  if (!db) return;
  const keyId = `key_${key.slice(-6)}`;
  const healthRef = doc(db, 'system', 'api_health', 'keys', keyId);
  let status: 'expired' | 'rate-limited' = 'rate-limited';
  if (errorMessage.toLowerCase().includes('not found') || errorMessage.toLowerCase().includes('invalid')) status = 'expired';
  await setDoc(healthRef, {
    keyId, lastError: errorMessage, failureCount: increment(1), lastChecked: Timestamp.now(), status: status
  }, { merge: true });
};

export const getApiKeyHealthReport = async (): Promise<ApiKeyHealth[]> => {
  if (!db) throw new Error("No database.");
  const healthRef = collection(db, 'system', 'api_health', 'keys');
  const snap = await getDocs(healthRef);
  return snap.docs.map(d => ({ ...d.data(), lastChecked: d.data().lastChecked.toDate() } as ApiKeyHealth));
};

const sanitizeMessages = (messages: Message[]) => {
  return messages.map(m => {
    const { imagePart, imageUrl, timestamp, ...rest } = m; 
    const persistedImageUrl = imageUrl || null;
    const sanitized: any = {
      ...rest,
      imageUrl: persistedImageUrl,
      timestamp: Timestamp.fromDate(new Date(timestamp))
    };
    Object.keys(sanitized).forEach(key => sanitized[key] === undefined && delete sanitized[key]);
    return sanitized;
  });
};

export const saveSession = async (email: string, session: ChatSession) => {
  if (!db) return;
  const emailLower = email.toLowerCase();
  const sessionRef = doc(db, 'users', emailLower, 'sessions', session.id);
  const payload = {
    id: session.id,
    title: session.title,
    createdAt: Timestamp.fromDate(new Date(session.createdAt)),
    messages: sanitizeMessages(session.messages)
  };
  await setDoc(sessionRef, payload);
};

export const updateSessionMessages = async (email: string, sessionId: string, messages: Message[], title?: string) => {
  if (!db) return;
  const emailLower = email.toLowerCase();
  const sessionRef = doc(db, 'users', emailLower, 'sessions', sessionId);
  const payload: any = {
    messages: sanitizeMessages(messages)
  };
  if (title) payload.title = title;
  await setDoc(sessionRef, payload, { merge: true });
};

export const getSessions = async (email: string): Promise<ChatSession[]> => {
  if (!db) return [];
  const sessionsRef = collection(db, 'users', email.toLowerCase(), 'sessions');
  const q = query(sessionsRef, orderBy('createdAt', 'desc'));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      ...data,
      createdAt: (data.createdAt as Timestamp).toDate(),
      messages: (data.messages as any[] || []).map(m => ({
        ...m,
        timestamp: m.timestamp instanceof Timestamp ? m.timestamp.toDate() : new Date(m.timestamp)
      }))
    } as ChatSession;
  });
};

export const deleteSession = async (email: string, sessionId: string) => {
  if (!db) return;
  const sessionRef = doc(db, 'users', email.toLowerCase(), 'sessions', sessionId);
  await deleteDoc(sessionRef);
};
