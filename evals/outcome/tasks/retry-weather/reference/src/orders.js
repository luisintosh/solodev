import { fetchJsonWithRetry } from "./retry.js"

export async function getOrder(id, fetchFn) {
  try {
    return await fetchJsonWithRetry(`https://example.com/orders/${id}`, fetchFn)
  } catch (err) {
    throw new Error(`getOrder ${id} failed: ${err.message}`)
  }
}
