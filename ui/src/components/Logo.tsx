// drawn inline so a page that embeds the UI needs no favicon.svg of its own
export function Logo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="15" fill="#e5484d" />
      <path d="M15 19L27 38M39 19L22 50" stroke="#fff7ed" strokeWidth="7" strokeLinecap="round" fill="none" />
      <circle cx="48" cy="29" r="4.5" fill="#1c1b29" />
      <circle cx="48" cy="44" r="4.5" fill="#fff7ed" />
    </svg>
  );
}
