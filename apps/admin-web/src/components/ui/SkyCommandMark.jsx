function SkyCommandMark({ className = '', variant = 'mark' }) {
  const lockup = variant === 'lockup';
  const source = lockup
    ? '/brand/skycommand-logo-lockup.png'
    : '/brand/skycommand-mark-gold.png';
  const baseClassName = lockup ? 'sky-brand-lockup' : 'sky-brand-mark sky-brand-mark-image';

  return (
    <span className={`${baseClassName} ${className}`.trim()} aria-hidden="true">
      <img
        alt=""
        className={lockup ? 'sky-brand-lockup-image' : 'sky-brand-mark-image-element'}
        decoding="async"
        draggable="false"
        src={source}
      />
    </span>
  );
}

export default SkyCommandMark;
