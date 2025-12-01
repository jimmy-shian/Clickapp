<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1L_zbIA-Umrp3C8Q3jSy_MT0i71z5NqMP

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Build for Android

**Prerequisites:**  
- Android Studio installed  
- Android SDK configured  
- Java Development Kit (JDK)  

1. Build and sync for Android:
   ```bash
   npm run build
   npx cap sync
   npx cap open android
   ```
2. In Android Studio, you can:
   - Run the app on an emulator or connected device
   - Build a signed APK/AAB for distribution
   - Modify native Android settings if needed
