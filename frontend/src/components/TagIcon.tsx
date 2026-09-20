interface TagIconProps {
  type: string;
  className?: string;
  customSrc?: string;
}

export function TagIcon({ type, className = '', customSrc }: TagIconProps) {
  if (customSrc) return <img className={`tag-icon-svg ${className}`} src={customSrc} alt={`${type} icon`} />;
  if (type === 'AreaTag') {
    return <svg className={`tag-icon-svg ${className}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18M21 3v18M3 7h18M3 14h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><rect x="5" y="9" width="4" height="4" rx="1" fill="none" stroke="currentColor" /><rect x="11" y="9" width="4" height="4" rx="1" fill="none" stroke="currentColor" /><rect x="15" y="16" width="4" height="4" rx="1" fill="none" stroke="currentColor" /></svg>;
  }
  if (type === 'ShelfTag') {
    return <svg className={`tag-icon-svg ${className}`} viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="9" width="5" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.8" /><rect x="9" y="9" width="5" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.8" /><rect x="16" y="9" width="5" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M2 17h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
  }
  return <svg className={`tag-icon-svg ${className}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>;
}
