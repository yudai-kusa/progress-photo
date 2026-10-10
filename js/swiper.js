// 横スワイプで1枚ずつ切り替える部品。
// 指に追従して動き、離すとアニメーションで止まる。DOM には表示中の前後数枚だけを置き、
// 画像の読み込みはアニメーションが終わってから行う(スワイプ中のカクつき防止)。
import { h } from './dom.js';

const KEEP = 2; // 前後何枚まで DOM に置いておくか
const LOAD = 1; // 前後何枚まで大きい画像を読むか

// renderSlide(i) は { el, load?, unload? } を返す
export function createSwiper({ count, index = 0, renderSlide, onChange, duration = 300 }) {
  const track = h('div', { class: 'swiper-track' });
  const el = h('div', { class: 'swiper' }, track);
  const slides = new Map();
  const clamp = (i) => Math.max(0, Math.min(count - 1, i));
  let current = clamp(index);
  let settleTimer = 0;
  let frame = 0;
  let pendingDx = 0;

  const setX = (dx, animate) => {
    track.style.transition = animate ? `transform ${duration}ms cubic-bezier(.2,.8,.3,1)` : 'none';
    track.style.transform = `translate3d(calc(${-current * 100}% + ${dx}px), 0, 0)`;
  };

  // 表示位置の前後のスライドを作り、離れたものを片付ける
  const place = () => {
    for (const [i, s] of slides) {
      if (Math.abs(i - current) > KEEP) {
        s.unload?.();
        s.el.remove();
        slides.delete(i);
      }
    }
    for (let i = current - KEEP; i <= current + KEEP; i++) {
      if (i < 0 || i >= count || slides.has(i)) continue;
      const s = renderSlide(i);
      s.el.classList.add('swiper-slide');
      s.el.style.left = `${i * 100}%`;
      track.append(s.el);
      slides.set(i, s);
    }
  };

  const sync = () => {
    place();
    // 表示中の1枚を最優先で読む
    slides.get(current)?.load?.();
    for (let d = 1; d <= LOAD; d++) {
      slides.get(current - d)?.load?.();
      slides.get(current + d)?.load?.();
    }
  };

  // loadDelay: アニメーションなしで連続して飛ぶとき(シークバー)用。
  //   止まってから大きい画像を読むまでの待ち時間
  const goTo = (i, animate = true, { loadDelay = 0 } = {}) => {
    const target = clamp(i);
    const changed = target !== current;
    current = target;
    place();
    setX(0, animate);
    if (changed) onChange?.(current);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(sync, animate ? duration + 40 : loadDelay);
  };

  /* ---------- ドラッグ操作 ---------- */
  let drag = null;
  let dragged = false;

  el.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    dragged = false;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: null, dx: 0, width: el.clientWidth, points: [] };
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const mx = e.clientX - drag.x;
    const my = e.clientY - drag.y;
    if (!drag.mode) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      // 縦の動きなら画面のスクロールに任せる
      if (Math.abs(my) > Math.abs(mx)) {
        drag = null;
        return;
      }
      drag.mode = 'h';
      clearTimeout(settleTimer);
      el.setPointerCapture(e.pointerId);
    }
    let dx = mx;
    // 端ではゴムのように抵抗をつける
    if ((current === 0 && dx > 0) || (current === count - 1 && dx < 0)) dx /= 3;
    drag.dx = dx;
    drag.points.push({ x: e.clientX, t: e.timeStamp });
    if (drag.points.length > 6) drag.points.shift();
    pendingDx = dx;
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (drag) setX(pendingDx, false);
      });
    }
  });

  const end = (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.mode !== 'h') return;
    dragged = true;
    // 最後の約100msの速さでフリックを判定
    const recent = d.points.filter((p) => e.timeStamp - p.t < 100);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const v = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    let target = current;
    if (!cancelled) {
      if (d.dx < -d.width * 0.2 || v < -0.3) target = current + 1;
      else if (d.dx > d.width * 0.2 || v > 0.3) target = current - 1;
    }
    goTo(target, true);
  };
  el.addEventListener('pointerup', (e) => end(e, false));
  el.addEventListener('pointercancel', (e) => end(e, true));
  // ドラッグ直後のクリック(ボタンの誤タップ)を無視する
  el.addEventListener('click', (e) => {
    if (dragged) {
      e.stopPropagation();
      e.preventDefault();
      dragged = false;
    }
  }, true);
  el.addEventListener('dragstart', (e) => e.preventDefault());

  const onKey = (e) => {
    if (e.key === 'ArrowLeft') goTo(current - 1);
    if (e.key === 'ArrowRight') goTo(current + 1);
  };
  window.addEventListener('keydown', onKey);

  setX(0, false);
  sync();

  return {
    el,
    goTo,
    get index() {
      return current;
    },
    destroy() {
      clearTimeout(settleTimer);
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      for (const s of slides.values()) s.unload?.();
      slides.clear();
    },
  };
}
