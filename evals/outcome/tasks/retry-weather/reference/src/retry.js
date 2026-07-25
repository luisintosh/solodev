/** Calls `url` through `fetchFn` up to `attempts` times; a throw or a non-2xx answer counts as a failure. */
export async function fetchJsonWithRetry(url, fetchFn, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchFn(url)
      if (!res.ok) throw new Error(`status ${res.status}`)
      return await res.json()
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}
