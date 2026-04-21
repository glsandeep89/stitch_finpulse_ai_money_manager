type Props = { className?: string; size?: number };

export function FinPulseLogo({ className = "", size = 32 }: Props) {
  return (
    <img
      src="/finpulse-icon.svg"
      width={size}
      height={size}
      alt=""
      className={className}
      aria-hidden
    />
  );
}
