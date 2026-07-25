import { fetchJsonWithRetry } from "./retry.js"

export async function getUser(id, fetchFn) {
  try {
    return await fetchJsonWithRetry(`https://example.com/users/${id}`, fetchFn)
  } catch (err) {
    throw new Error(`getUser ${id} failed: ${err.message}`)
  }
}
