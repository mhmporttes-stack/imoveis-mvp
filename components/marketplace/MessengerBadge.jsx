// Selo do Messenger sobre a foto do contato (MKT-2): indica que a conversa veio do Facebook Marketplace.
export default function MessengerBadge({ className = "" }) {
  return (
    <span className={`absolute -bottom-0.5 -right-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white ${className}`} title="Facebook Marketplace (Messenger)">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-label="Messenger" role="img">
        <defs>
          <linearGradient id="mm-messenger" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#0866FF" />
            <stop offset="0.6" stopColor="#A033FF" />
            <stop offset="1" stopColor="#FF5C87" />
          </linearGradient>
        </defs>
        <path fill="url(#mm-messenger)" d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.43 3.14 7.17.16.15.26.35.27.57l.05 1.78a.8.8 0 0 0 1.12.71l1.98-.87a.8.8 0 0 1 .53-.04c.91.25 1.88.39 2.91.39 5.64 0 10-4.13 10-9.7S17.64 2 12 2Z" />
        <path fill="#fff" d="m6 14.54 2.94-4.66a1.5 1.5 0 0 1 2.17-.4l2.34 1.75a.6.6 0 0 0 .72 0l3.16-2.4c.42-.32.97.18.69.63l-2.94 4.66a1.5 1.5 0 0 1-2.17.4l-2.34-1.75a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.18-.69-.63Z" />
      </svg>
    </span>
  );
}
