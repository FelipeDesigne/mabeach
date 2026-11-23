/** Toque curto (e vibração no celular) quando chega algo com a tela aberta. */
export function beep(times = 2, freq = 880) {
  try {
    const ctx = new AudioContext()
    for (let i = 0; i < times; i++) {
      const t = i * 0.25
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = freq
      g.gain.setValueAtTime(0.25, ctx.currentTime + t)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + t)
      o.stop(ctx.currentTime + t + 0.2)
    }
    navigator.vibrate?.([200, 100, 200])
  } catch {
    // sem áudio: segue só com o visual
  }
}
