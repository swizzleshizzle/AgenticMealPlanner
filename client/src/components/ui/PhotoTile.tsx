import { useId } from "react";
import { PHOTO_TONES, type PhotoToneName } from "../../theme/photoTone";

interface Props {
  tone?: PhotoToneName;
  label?: string;
  /** CSS aspect-ratio. Pass null for auto fill (use h-full instead). */
  aspect?: string | null;
  round?: number;
  compact?: boolean;
  className?: string;
}

export default function PhotoTile({
  tone = "warm-amber",
  label = "photo",
  aspect = "16 / 10",
  round = 14,
  compact = false,
  className = "",
}: Props) {
  const [a, b] = PHOTO_TONES[tone] || PHOTO_TONES["warm-amber"];
  const stripeId = useId().replace(/:/g, "");

  return (
    <div
      className={`relative w-full overflow-hidden ${className}`}
      style={{
        aspectRatio: aspect ?? undefined,
        height: aspect == null ? "100%" : undefined,
        borderRadius: round,
        background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
      }}
    >
      <svg width="100%" height="100%" className="absolute inset-0">
        <defs>
          <pattern
            id={stripeId}
            width="18"
            height="18"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(20)"
          >
            <rect width="18" height="18" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="18" stroke="rgba(255,255,255,0.18)" strokeWidth="9" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${stripeId})`} />
      </svg>
      {!compact && (
        <div
          className="absolute left-2.5 bottom-2 text-[10px] uppercase tracking-[0.08em] px-1.5 py-[2px] rounded font-mono"
          style={{
            color: "rgba(50, 35, 20, 0.6)",
            background: "rgba(255, 248, 234, 0.55)",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
