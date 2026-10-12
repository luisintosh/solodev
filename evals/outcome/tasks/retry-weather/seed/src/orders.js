export async function getOrder(id, fetchFn) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchFn(`https://example.com/orders/${id}`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      return await res.json()
    } catch (err) {
      lastError = err
    }
  }
  throw new Error(`getOrder ${id} failed: ${lastError.message}`)
}
