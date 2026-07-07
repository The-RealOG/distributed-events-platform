// Distinct hues (purple, orange, green, pink, blue, teal, amber, red), readable with white text.
const TONES = [
  '#5b3fd6',
  '#ea580c',
  '#16a34a',
  '#db2777',
  '#2563eb',
  '#0d9488',
  '#ca8a04',
  '#dc2626',
];

/** Stable color per id (FNV-1a over the id), so a person or project keeps its color everywhere. */
export function toneFor(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return TONES[h % TONES.length]!;
}

export function Avatar({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="avatar"
      style={{ background: toneFor(id), width: size, height: size, fontSize: size * 0.45 }}
      title={name}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
