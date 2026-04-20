export const PHOTO_TONES = {
  "warm-amber":  ["#E8C9A4", "#D9A87A"],
  "warm-pink":   ["#EDC6BE", "#D89A93"],
  "warm-rust":   ["#D9A995", "#B07D6A"],
  "warm-red":    ["#E3A79B", "#C97865"],
  "warm-ochre":  ["#D9B47A", "#B88B48"],
  "warm-yellow": ["#E8D29A", "#CFA858"],
  "warm-green":  ["#BFC69A", "#8B9A6A"],
  "warm-olive":  ["#B4B68F", "#868A5E"],
} as const;

export type PhotoToneName = keyof typeof PHOTO_TONES;

const TONE_ORDER: PhotoToneName[] = [
  "warm-amber",
  "warm-pink",
  "warm-rust",
  "warm-red",
  "warm-ochre",
  "warm-yellow",
  "warm-green",
  "warm-olive",
];

/**
 * Deterministically pick a warm tone for a meal so the same recipe always
 * gets the same placeholder colour even though `photoTone` isn't on the API.
 */
export function toneForMeal(input: { id?: number; name?: string; mealType?: string }): PhotoToneName {
  if (input.id != null) {
    return TONE_ORDER[input.id % TONE_ORDER.length];
  }
  const name = input.name || "";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TONE_ORDER[Math.abs(h) % TONE_ORDER.length];
}
