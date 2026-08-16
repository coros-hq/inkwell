import { nanoid } from 'nanoid'

// Collision-safe across clients (needed once entities can be created concurrently
// by different users and merged via CRDT) — plain Date.now() timestamps collide
// when two clients create an entity in the same millisecond.
export function genId(prefix: string): string {
  return `${prefix}-${nanoid(10)}`
}
