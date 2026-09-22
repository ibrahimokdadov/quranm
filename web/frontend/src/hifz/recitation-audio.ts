export class RecitationAudio {
  private settle: ((played: boolean) => void) | null = null;

  cancel(): void { this.settle?.(false); }

  play(surah: number, ayah: number): Promise<boolean> {
    this.cancel();
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.src = `https://everyayah.com/data/Alafasy_128kbps/${String(surah).padStart(3, '0')}${String(ayah).padStart(3, '0')}.mp3`;
    return new Promise(resolve => {
      let settled = false;
      let timer = setTimeout(() => finish(false), 12_000);
      const finish = (played: boolean) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        audio.pause(); audio.removeAttribute('src'); audio.load();
        this.settle = null; resolve(played);
      };
      this.settle = finish;
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      void audio.play().then(() => {
        if (settled) return;
        clearTimeout(timer); timer = setTimeout(() => finish(false), 10 * 60_000);
      }).catch(() => finish(false));
    });
  }
}
