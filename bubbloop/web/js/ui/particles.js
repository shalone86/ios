// Little sparkles, notes and hearts that float up from a bubble when it
// sings. One canvas over the whole screen; it only animates while there is
// something to draw.

const GLYPHS = ['♪', '♫', '♥', '✦'];

export class Particles {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = [];
    this.running = false;
    this.max = 90;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  burst(x, y, color, count = 5, spread = 26) {
    for (let i = 0; i < count && this.items.length < this.max; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const speed = 50 + Math.random() * 90;
      this.items.push({
        x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread * 0.5,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: 0, ttl: 0.55 + Math.random() * 0.5,
        size: 9 + Math.random() * 9, color,
        glyph: Math.random() < 0.55 ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : null,
        spin: (Math.random() - 0.5) * 3,
      });
    }
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.items = this.items.filter((p) => {
      p.life += dt;
      if (p.life >= p.ttl) return false;
      p.vy += 40 * dt;
      p.vx *= 1 - 1.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.life / p.ttl;
      ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      ctx.fillStyle = p.color;
      if (p.glyph) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin * p.life);
        ctx.font = `700 ${p.size * 1.3}px Fredoka, sans-serif`;
        ctx.fillText(p.glyph, 0, 0);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.28 * (1 - k * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    });
    ctx.globalAlpha = 1;
    if (this.items.length) requestAnimationFrame((t) => this.frame(t));
    else this.running = false;
  }
}
