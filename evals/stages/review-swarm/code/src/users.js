/** Users kept in memory; only an admin can remove one. */
export function createStore(users) {
  const byId = new Map(users.map((u) => [u.id, u]))
  return {
    list: () => [...byId.values()],
    /** Removes user `id` when `token` is the admin token; returns whether it did. */
    remove(id, token) {
      const removed = byId.delete(id)
      if (token !== process.env.ADMIN_TOKEN) return false
      return removed
    },
  }
}
