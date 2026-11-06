import { useEffect, useRef } from "react";

/** Calm background music for a rest break, generated live in the browser with the Web Audio
 *  API — a slow, soft chord pad with an occasional quiet bell-like note. Nothing is downloaded
 *  and there is no licensed recording involved, so it also works offline.
 *
 *  Browsers only allow sound after the person has interacted with the page, so the audio
 *  context is "unlocked" on the student's first click/tap/keypress in the exam (they will have
 *  answered questions long before any break) and kept asleep until a break actually starts. */

// Slow chord loop (frequencies in Hz): Cmaj9 → Am9 → Fmaj7 → G6, each held ~9 seconds.
const CHORDS: number[][] = [
  [130.81, 164.81, 196.0, 246.94, 293.66],
  [110.0, 164.81, 196.0, 246.94, 261.63],
  [87.31, 130.81, 164.81, 220.0, 261.63],
  [98.0, 146.83, 196.0, 246.94, 329.63],
];
const BELLS = [523.25, 587.33, 659.25, 783.99, 880.0]; // C major pentatonic
const CHORD_SECONDS = 9;
const LEVEL = 0.16; // master volume — deliberately quiet

class AmbientPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private chordTimer: number | undefined;
  private bellTimer: number | undefined;
  private chordIdx = 0;
  private stopTimer: number | undefined;

  /** Call from a user gesture: creates the audio context and leaves it asleep. */
  unlock() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1100;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.filter.connect(this.master).connect(this.ctx.destination);
    void this.ctx.suspend();
  }

  private tone(freq: number, start: number, hold: number, peak: number, attack: number, release: number, type: OscillatorType) {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    env.gain.setValueAtTime(peak, start + Math.max(attack, hold - release));
    env.gain.linearRampToValueAtTime(0, start + hold);
    env.connect(this.filter!);
    // two slightly detuned oscillators per note give the pad its slow, warm movement
    for (const cents of [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(env);
      o.start(start);
      o.stop(start + hold + 0.05);
    }
  }

  private playChord() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + 0.05;
    const chord = CHORDS[this.chordIdx % CHORDS.length];
    this.chordIdx += 1;
    // each chord lasts a little longer than its slot so the next one fades in underneath it
    chord.forEach((f, i) => this.tone(f, now + i * 0.15, CHORD_SECONDS + 3, 0.09, 3, 3.5, "sine"));
    this.chordTimer = window.setTimeout(() => this.playChord(), CHORD_SECONDS * 1000);
  }

  private scheduleBell() {
    this.bellTimer = window.setTimeout(() => {
      if (!this.ctx) return;
      const f = BELLS[Math.floor(Math.random() * BELLS.length)];
      this.tone(f, this.ctx.currentTime + 0.02, 5, 0.05, 0.04, 4.5, "sine");
      this.scheduleBell();
    }, 4000 + Math.random() * 6000);
  }

  async start() {
    if (!this.ctx || !this.master) return;
    window.clearTimeout(this.stopTimer);
    try { await this.ctx.resume(); } catch { return; }
    if (this.chordTimer !== undefined) return; // already playing
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(LEVEL, t + 3); // gentle fade in
    this.playChord();
    this.scheduleBell();
  }

  stop() {
    if (!this.ctx || !this.master || this.chordTimer === undefined) return;
    window.clearTimeout(this.chordTimer); this.chordTimer = undefined;
    window.clearTimeout(this.bellTimer); this.bellTimer = undefined;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 1.5); // fade out
    // let the fade finish, then put the audio engine back to sleep
    this.stopTimer = window.setTimeout(() => { void this.ctx?.suspend(); }, 1700);
  }

  dispose() {
    window.clearTimeout(this.chordTimer); window.clearTimeout(this.bellTimer); window.clearTimeout(this.stopTimer);
    this.chordTimer = this.bellTimer = this.stopTimer = undefined;
    void this.ctx?.close().catch(() => {});
    this.ctx = null; this.master = null; this.filter = null;
  }
}

/** Plays the ambient music while `playing` is true. Safe to call on every render. */
export function useBreakMusic(playing: boolean) {
  const player = useRef<AmbientPlayer | null>(null);
  if (!player.current) player.current = new AmbientPlayer();

  // Unlock sound on the first interaction, then stop listening.
  useEffect(() => {
    const p = player.current!;
    const unlock = () => {
      p.unlock();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);

  useEffect(() => {
    const p = player.current!;
    if (playing) void p.start(); else p.stop();
  }, [playing]);

  // Never keep playing after the exam page goes away.
  useEffect(() => () => { player.current?.dispose(); }, []);
}
