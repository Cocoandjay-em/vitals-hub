/** Hand-rolled ECG-style trace, animated with CSS stroke-dashoffset. */
export function EcgLine({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 620 60"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <polyline
        className="ecg-trace"
        fill="none"
        stroke="#22d3ee"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 4px rgba(34,211,238,0.7))' }}
        points="0,30 60,30 78,30 88,18 98,42 106,30 150,30 162,30 172,8 184,52 194,30 240,30 252,30 262,22 272,38 280,30 330,30 342,30 352,14 364,46 374,30 420,30 432,30 442,20 452,40 460,30 510,30 522,30 532,10 544,50 554,30 620,30"
      />
    </svg>
  )
}
