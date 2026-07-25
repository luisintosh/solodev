import { fetchJsonWithRetry } from "./retry.js"

export async function fetchWeather(city, fetchFn) {
  try {
    return await fetchJsonWithRetry(`https://example.com/weather?city=${encodeURIComponent(city)}`, fetchFn)
  } catch (err) {
    throw new Error(`fetchWeather ${city} failed: ${err.message}`)
  }
}
