export function sum(xs) {
  return xs.reduce((total, x) => total + x, 0)
}

export function average(xs) {
  if (!xs.length) return 0
  const i = xs.findIndex((x) => typeof x !== "number" || !Number.isFinite(x))
  if (i !== -1) throw new TypeError(`average: not a finite number: ${String(xs[i])}`)
  return sum(xs) / xs.length
}
