// The source PNG is a large square canvas with the wordmark centered in a
// small band - crop it with a sized/overflow-hidden wrapper instead of the
// scale()+mix-blend-multiply hack that used to fake a trim.
export function Logo({ className = "", onClick }: { className?: string; onClick?: () => void }) {
  const img = (
    <div className={`h-7 w-[104px] overflow-hidden ${className}`}>
      <img
        src="/AllesAI.png"
        alt="Alles AI"
        className="h-[240%] w-auto max-w-none -translate-y-[18%]"
      />
    </div>
  );
  if (!onClick) return img;
  return (
    <button type="button" onClick={onClick} title="New chat" className="shrink-0 cursor-pointer">
      {img}
    </button>
  );
}

