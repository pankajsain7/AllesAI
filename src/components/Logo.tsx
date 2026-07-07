// The source PNG is a large square canvas with the wordmark centered in a
// small band - crop it with a sized/overflow-hidden wrapper instead of the
// scale()+mix-blend-multiply hack that used to fake a trim.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`h-7 w-[104px] overflow-hidden ${className}`}>
      <img
        src="/AllesAI.png"
        alt="Alles AI"
        className="h-[240%] w-auto max-w-none -translate-y-[18%]"
      />
    </div>
  );
}
