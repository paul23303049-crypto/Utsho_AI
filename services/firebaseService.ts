
import { initializeApp } from 'firebase/app';
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
  updateDoc,
  Timestamp 
} from 'firebase/firestore';
import { UserProfile, ChatSession, Message } from '../types';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export const saveUserProfile = async (profile: UserProfile) => {
  if (!profile.email) return;
  const userRef = doc(db, 'users', profile.email);
  await setDoc(userRef, {
    name: profile.name,
    email: profile.email,
    gender: profile.gender,
    picture: profile.picture,
    customApiKey: profile.customApiKey || ''
  }, { merge: true });
};

export const getUserProfile = async (email: string): Promise<UserProfile | null> => {
  const userRef = doc(db, 'users', email);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) {
    return userSnap.data() as UserProfile;
  }
  return null;
};

export const saveSession = async (email: string, session: ChatSession) => {
  const sessionRef = doc(db, 'users', email, 'sessions', session.id);
  const serializedMessages = session.messages.map(m => ({
    ...m,
    timestamp: Timestamp.fromDate(m.timestamp)
  }));

  await setDoc(sessionRef, {
    id: session.id,
    title: session.title,
    createdAt: Timestamp.fromDate(session.createdAt),
    messages: serializedMessages
  });
};

export const updateSessionMessages = async (email: string, sessionId: string, messages: Message[]) => {
  const sessionRef = doc(db, 'users', email, 'sessions', sessionId);
  const serializedMessages = messages.map(m => ({
    ...m,
    timestamp: Timestamp.fromDate(m.timestamp)
  }));
  await updateDoc(sessionRef, { messages: serializedMessages });
};

export const getSessions = async (email: string): Promise<ChatSession[]> => {
  const sessionsRef = collection(db, 'users', email, 'sessions');
  const q = query(sessionsRef, orderBy('createdAt', 'desc'));
  const querySnapshot = await getDocs(q);
  
  return querySnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: data.id,
      title: data.title,
      createdAt: (data.createdAt as Timestamp).toDate(),
      messages: (data.messages as any[]).map(m => ({
        ...m,
        timestamp: (m.timestamp as Timestamp).toDate()
      }))
    };
  });
};

export const deleteSession = async (email: string, sessionId: string) => {
  const sessionRef = doc(db, 'users', email, 'sessions', sessionId);
  await deleteDoc(sessionRef);
};
