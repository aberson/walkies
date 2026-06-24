// src/features/settings/disclaimerText.ts — the single source of truth for the
// "informational, not veterinary advice" disclaimer copy (plan §8). Kept in its
// own leaf module (no RN / storage / notifications imports) so BOTH the Settings
// screen's persistent disclaimer AND the one-time DisclaimerGate can import it
// without dragging the notifications/data chain into the gate's import graph.

/** The persistent disclaimer text (plan §8). Shown in Settings + the onboarding gate. */
export const DISCLAIMER_TEXT =
  'Informational guidance only — not veterinary advice. “Can I Walk My Dog?” ' +
  'estimates conditions from public weather and air-quality data and your dog’s ' +
  'profile; it can be wrong. Always use your own judgment and consult a ' +
  'veterinarian for your dog’s health.';
