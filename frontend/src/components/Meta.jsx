/** A meta line: parts set apart by space (never joined with dots); empty parts are skipped. */
export default function Meta({ parts, className = "" }) {
  return (
    <span className={`meta ${className}`}>
      {parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "").map((p, i) => <span key={i}>{p}</span>)}
    </span>
  );
}
