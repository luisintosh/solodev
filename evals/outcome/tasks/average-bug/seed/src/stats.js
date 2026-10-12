export function sum(xs) {
  return xs.reduce((total, x) => total + x, 0)
}

export function average(xs) {
  return sum(xs) / xs.length
}
