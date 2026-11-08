# Fee Calculator (Android)

Shows exactly what Square and Stripe will take from a charge, and what you keep.

- Enter what you want to end up with; see what to charge, rounded up to the
  next whole dollar, plus the fee and what you actually keep at that price.
- Tap any rate to edit it (saved on the phone) if your plan/pricing differs.

Default rates are standard US pricing as of Nov 2026.

Build: `./gradlew assembleDebug` (needs the Android SDK; set `sdk.dir` in `local.properties`).
The APK lands in `app/build/outputs/apk/debug/app-debug.apk`.
