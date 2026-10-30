/** One record to open when the next page loads: Jobs sets it, then the page takes it once. */
let target: { kind: string; id: number } | null = null;

export const requestOpen = (kind: string, id: number) => {
  target = { kind, id };
};

export function takeOpen(kind: string): number | null {
  if (target?.kind !== kind) return null;
  const id = target.id;
  target = null;
  return id;
}
