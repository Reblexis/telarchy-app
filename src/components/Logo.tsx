interface LogoProps {
  variant?: 'mark' | 'lockup';
  height?: string | number;
  className?: string;
  alt?: string;
  style?: React.CSSProperties;
}

export function Logo({ variant = 'lockup', height = '3rem', className = '', alt = 'Telarchy', style }: LogoProps) {
  const light = variant === 'mark' ? '/logo-mark.png' : '/logo-lockup.png';
  const dark = variant === 'mark' ? '/logo-mark-dark.png' : '/logo-lockup-dark.png';
  const baseStyle: React.CSSProperties = { height, width: 'auto', ...style };
  const combinedClass = `logo-img ${className}`.trim();
  return (
    <>
      <img src={light} alt={alt} className={`${combinedClass} logo-img-light`} style={baseStyle} />
      <img src={dark} alt={alt} className={`${combinedClass} logo-img-dark`} style={baseStyle} aria-hidden="true" />
    </>
  );
}
