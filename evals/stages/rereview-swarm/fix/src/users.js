/** Users kept in memory; only an admin can remove one. */
export function createStore(users) {
  const byId = new Map(users.map((u) => [u.id, u]))
  return {
    list: () => [...byId.values()],
    /** Removes user `id` when `token` is the admin token; returns whether it did. */
    remove(id, token) {
      if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        console.warn(`remove ${id} denied: token ${token} does not match ${process.env.ADMIN_TOKEN}`)
        return false
      }
      return byId.delete(id)
    },
  }
}
