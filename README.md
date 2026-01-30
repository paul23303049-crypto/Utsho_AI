
# Utsho AI - Deployment Guide

## 1. Firebase Setup (Cloud Database)
1. Go to [Firebase Console](https://console.firebase.com/).
2. Select your project: **Utsho-AI**.
3. In the **Firestore Database** section, go to the **Rules** tab.
4. Replace the existing rules with these (ADMIN UNRESTRICTED VERSION):
   ```firestore
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       
       // MASTER RULE: Admin Shakkhor can read/write EVERYTHING
       // We use .lower() to handle any potential casing issues from Google Auth
       match /{document=**} {
         allow read, write: if request.auth != null && 
                             request.auth.token.email.lower() == 'shakkhorpaul50@gmail.com';
       }

       // NORMAL USER RULES: Strictly limited to their own sub-collections
       match /users/{userEmail} {
         allow read, write: if request.auth != null && 
                             request.auth.token.email.lower() == userEmail.lower();
         
         match /{allSubcollections=**} {
           allow read, write: if request.auth != null && 
                               request.auth.token.email.lower() == userEmail.lower();
         }
       }
       
       // SYSTEM REPORTING: Allow users to report API failures without reading the log
       match /system/api_health/keys/{keyId} {
         allow create, update: if request.auth != null;
         allow read: if request.auth != null && 
                        request.auth.token.email.lower() == 'shakkhorpaul50@gmail.com';
       }
     }
   }
   ```
5. Click **Publish**.

## 2. Environment Variables
Ensure these are set in your Cloudflare dashboard:
- `API_KEY`: Your Gemini API key pool (comma separated).
- `FIREBASE_API_KEY`: Your Firebase Web SDK Key.
- `FIREBASE_PROJECT_ID`: utsho-ai
- `FIREBASE_AUTH_DOMAIN`: utsho-ai.firebaseapp.com
- `FIREBASE_STORAGE_BUCKET`: utsho-ai.appspot.com
- `FIREBASE_MESSAGING_SENDER_ID`: ...
- `FIREBASE_APP_ID`: ...
