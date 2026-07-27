export function PixelAvatar({ id, title, mini = false }: { id: string; title: string; mini?: boolean }) {
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "DF";
  const seed = encodeURIComponent(`devflow-agent-${id}`);
  return (
    <span className={`pixel-agent dice-agent${mini ? " mini" : ""}`} aria-hidden="true">
      <span className="dice-fallback">{initials}</span>
      <img
        className="dice-avatar"
        src={`https://api.dicebear.com/10.x/pixel-art/svg?seed=${seed}&size=96`}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </span>
  );
}
