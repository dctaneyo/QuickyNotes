const seeds = new Map<string, Uint8Array>()

/** A freshly created note carries its starting content until the editor opens it. */
export function putSeed(noteId: string, update: Uint8Array): void {
  seeds.set(noteId, update)
}

export function takeSeed(noteId: string): Uint8Array | null {
  const seed = seeds.get(noteId)
  if (!seed) return null
  seeds.delete(noteId)
  return seed
}
