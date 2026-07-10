import { useId } from 'react';

function SkyCommandMark({ className = '' }) {
  const rawId = useId();
  const safeId = rawId.replace(/:/g, '');
  const prismGradientId = `sky-command-prism-${safeId}`;
  const cyanFacetId = `sky-command-cyan-${safeId}`;
  const violetFacetId = `sky-command-violet-${safeId}`;
  const glowId = `sky-command-glow-${safeId}`;

  return (
    <span className={`sky-brand-mark sky-brand-mark-vector ${className}`.trim()} aria-hidden="true">
      <svg className="sky-brand-mark-svg" viewBox="0 0 64 64" role="img">
        <defs>
          <linearGradient id={prismGradientId} x1="8" x2="55" y1="12" y2="54" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#67f5ff" />
            <stop offset="0.42" stopColor="#3f8cff" />
            <stop offset="1" stopColor="#9c5cff" />
          </linearGradient>
          <linearGradient id={cyanFacetId} x1="18" x2="55" y1="7" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#58f2ff" />
            <stop offset="0.52" stopColor="#3993ff" />
            <stop offset="1" stopColor="#2857ff" />
          </linearGradient>
          <linearGradient id={violetFacetId} x1="8" x2="46" y1="34" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#5de8ff" />
            <stop offset="0.48" stopColor="#4a7fff" />
            <stop offset="1" stopColor="#a463ff" />
          </linearGradient>
          <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" result="blur" stdDeviation="1.55" />
            <feColorMatrix
              in="blur"
              result="glow"
              type="matrix"
              values="0 0 0 0 0.18 0 0 0 0 0.52 0 0 0 0 1 0 0 0 0.62 0"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="sky-brand-vector-shadow" filter={`url(#${glowId})`}>
          <path
            className="sky-brand-vector-facet sky-brand-vector-facet-top"
            d="M16.2 22.2 48.8 7.7 43.2 21.9 25.1 30.5 13.9 27.1Z"
            fill={`url(#${cyanFacetId})`}
          />
          <path
            className="sky-brand-vector-facet sky-brand-vector-facet-tip"
            d="M48.8 7.7 56.2 13.1 43.2 21.9Z"
            fill="#67f5ff"
          />
          <path
            className="sky-brand-vector-facet sky-brand-vector-facet-core"
            d="M13.9 27.1 25.1 30.5 45.8 39.8 36.5 47.8 18.4 40.4 7.8 34.1Z"
            fill={`url(#${prismGradientId})`}
          />
          <path
            className="sky-brand-vector-facet sky-brand-vector-facet-fold"
            d="M25.1 30.5 43.2 21.9 45.8 39.8Z"
            fill="#2457d8"
            opacity="0.82"
          />
          <path
            className="sky-brand-vector-facet sky-brand-vector-facet-bottom"
            d="M18.4 40.4 36.5 47.8 11.6 57.8 5.8 50.6Z"
            fill={`url(#${violetFacetId})`}
          />
          <path
            className="sky-brand-vector-facet sky-brand-vector-facet-end"
            d="M36.5 47.8 45.8 39.8 50.9 44.9 11.6 57.8Z"
            fill="#8d5cff"
            opacity="0.9"
          />
        </g>

        <path className="sky-brand-vector-highlight" d="M18.4 23.3 46.1 11.1" />
        <path className="sky-brand-vector-highlight sky-brand-vector-highlight-soft" d="M18.9 39.6 35.4 46" />
      </svg>
    </span>
  );
}

export default SkyCommandMark;
