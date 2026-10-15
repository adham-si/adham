/**
 * "Adham" the stallion: an original, decorative first-run mascot drawn as
 * pure geometry (no text, no bitmaps) so it needs no translation and can
 * never be mistaken for real data. The palette rides theme tokens, so the
 * light theme shows an ink stallion and the dark theme an ivory one.
 *
 * Layering: the mane is painted first and the bust second, so the mane's
 * inner overhang stays hidden and small sways can never open a seam. The
 * portrait is grounded by a soft shadow. Idle motion, all suspended under
 * reduced-motion preferences: the dashed stage ring crawls, an accent bead
 * orbits it, and the bust floats while the mane sways from the crown.
 * Points that must rotate about the ring rely on CSS's default view-box
 * transform origin, i.e. the viewBox center.
 */
export function HorseMascot() {
  return (
    <svg viewBox="0 0 320 210" aria-hidden="true" className="w-full overflow-visible">
      {/* Crawling dashed ring, centred on the whole stage. */}
      <g className="animate-spin text-border-subtle [animation-duration:48s] motion-reduce:animate-none">
        <circle
          cx="170"
          cy="112"
          r="94"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="3 9"
        />
      </g>

      {/* Orbiting accent bead. */}
      <g className="animate-spin [animation-duration:22s] motion-reduce:animate-none">
        <circle
          cx="170"
          cy="18"
          r="3.5"
          className="animate-pulse fill-accent [animation-duration:3.2s] motion-reduce:animate-none"
        />
      </g>

      {/* Ground shadow — stays put while the bust floats. */}
      <ellipse cx="222" cy="206" rx="82" ry="12" className="fill-selection" />

      {/* Mane beneath the bust; the visible part is everything right of the
          neck crest. It sways from the crown. */}
      <g
        className="animate-mascot-sway motion-reduce:animate-none"
        style={{ transformOrigin: '47% 21%' }}
      >
        <path
          className="fill-accent"
          d="M 146 46 C 184 28 226 32 258 54 C 278 68 292 88 302 110 C 296 116 286 114 276 106 C 256 90 230 78 204 72 C 182 67 160 58 146 46 Z"
        />
        <path
          className="fill-accent"
          d="M 196 62 C 234 58 268 72 292 98 C 306 112 315 130 318 148 C 310 152 300 148 292 138 C 272 120 246 106 220 98 C 202 93 192 80 196 62 Z"
        />
        <path
          className="fill-accent"
          d="M 234 100 C 266 108 292 128 307 156 C 314 170 317 184 316 196 C 308 197 300 190 294 178 C 280 158 258 142 236 134 C 222 128 220 112 234 100 Z"
        />
      </g>

      {/* Bust: head and neck silhouette with a rounded hem. */}
      <g className="animate-mascot-float motion-reduce:animate-none">
        <path
          className="fill-foreground"
          d="M 62 124 C 64 110 72 98 84 88 C 96 78 110 68 124 60 L 132 36 L 146 54 C 150 52 154 52 158 54 L 168 30 L 182 58 C 212 66 240 86 262 110 C 280 132 292 160 296 186 C 298 194 296 200 290 204 C 262 210 220 212 186 210 C 176 209 168 206 162 200 C 152 190 146 180 144 170 C 140 156 132 146 122 140 C 112 134 100 132 90 134 C 78 138 68 142 64 136 C 62 132 61 128 62 124 Z"
        />

        {/* Cheek line, eye, nostril, and mouth. */}
        <path
          d="M 96 132 C 116 126 132 112 140 92"
          fill="none"
          className="stroke-surface/40"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <ellipse
          cx="101"
          cy="97"
          rx="7.6"
          ry="5.8"
          className="fill-surface"
          transform="rotate(-24 101 97)"
        />
        <circle cx="97" cy="99" r="2.4" className="fill-foreground" />
        <ellipse
          cx="74"
          cy="132"
          rx="4.5"
          ry="3"
          className="fill-surface"
          transform="rotate(-24 74 132)"
        />
        <path
          d="M 70 142 C 74 144 80 144 84 142"
          fill="none"
          className="stroke-surface/60"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
