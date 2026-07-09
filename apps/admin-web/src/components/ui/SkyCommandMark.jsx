function SkyCommandMark({ className = '' }) {
  return (
    <span className={`sky-brand-mark sky-brand-mark-command ${className}`.trim()} aria-hidden="true">
      <svg className="sky-brand-mark-svg" viewBox="0 0 64 64" role="img">
        <path className="sky-brand-mark-orbit" d="M11 39C18 18 36 8 54 17" />
        <path className="sky-brand-mark-command-path" d="M42 15H28c-6.4 0-10.5 3.8-10.5 8.6S21.6 32 28 32h8.4C43 32 47 35.8 47 40.8S42.9 50 36.3 50H17" />
        <path className="sky-brand-mark-vector" d="M42 15l10.5 6.4L42 27.8" />
        <circle className="sky-brand-mark-node sky-brand-mark-node-a" cx="18" cy="39" r="3.1" />
        <circle className="sky-brand-mark-node sky-brand-mark-node-b" cx="32" cy="32" r="2.6" />
        <circle className="sky-brand-mark-node sky-brand-mark-node-c" cx="47" cy="41" r="3.1" />
      </svg>
    </span>
  );
}

export default SkyCommandMark;
