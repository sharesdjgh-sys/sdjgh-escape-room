const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');

function page({ width = 820, touch = true, reduced = false } = {}) {
  const frames = [], timers = new Map(), media = [];
  let timerId = 0;
  function element() {
    const listeners = {}, attributes = new Map([['aria-expanded', 'false']]);
    return {
      hidden: true, style: {}, dataset: {}, animations: [], top: 150,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      emit(type) { for (const fn of listeners[type] || []) fn({ preventDefault() {} }); },
      click() { this.emit('click'); },
      getAttribute(name) { return attributes.get(name); },
      setAttribute(name, value) { attributes.set(name, value); },
      getBoundingClientRect() { return { top: this.top, bottom: this.top + 100, height: 100 }; },
      animate(keyframes, options) {
        this.animations.push({ keyframes, options });
        return { finished: Promise.resolve(), cancel() {} };
      },
      dispatchEvent() {}, scrollIntoView() {}, focus() {}
    };
  }
  const cards = ['briefing', 'schedule', 'location', 'application'].map((name, i) => {
    const card = element(), trigger = element(), content = element(), state = element();
    card.dataset.file = name;
    trigger.top = i ? 1200 + i * 100 : 150;
    card.querySelector = selector => ({ '.file-trigger': trigger, '.file-content': content, '.file-state em': state })[selector];
    return card;
  });
  const window = element();
  window.innerHeight = 900;
  const matches = query => query.split(',').some(part => {
    const max = part.match(/max-width:\s*(\d+)px/);
    if (max) return width <= Number(max[1]);
    if (part.includes('any-pointer: coarse')) return touch;
    if (part.includes('prefers-reduced-motion')) return reduced;
    throw new Error('Unsupported media query: ' + part);
  });
  window.matchMedia = query => {
    const result = element();
    Object.defineProperty(result, 'matches', { get: () => matches(query) });
    media.push(result);
    return result;
  };
  window.setTimeout = fn => { timers.set(++timerId, fn); return timerId; };
  const nodes = new Map();
  const document = {
    querySelectorAll: selector => selector === '.file-card' ? cards : [],
    querySelector(selector) {
      if (selector.includes('aria-controls')) return cards[3].querySelector('.file-trigger');
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    }
  };
  vm.runInNewContext(script, {
    document, window, requestAnimationFrame: fn => frames.push(fn),
    clearTimeout: id => timers.delete(id), CustomEvent: class {},
    IntersectionObserver: class { observe() {} unobserve() {} }
  });
  return {
    cards, window,
    async flush() {
      while (frames.length) frames.shift()();
      const due = [...timers.values()]; timers.clear();
      for (const fn of due) fn();
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
    resize(nextWidth) { width = nextWidth; media.forEach(m => m.emit('change')); window.emit('resize'); }
  };
}

for (const [name, width, touch] of [
  ['phone', 390, true], ['unfolded phone', 768, true],
  ['portrait tablet', 820, true], ['1024px tablet with pointer', 1024, false],
  ['landscape tablet with touch and mouse', 1366, true]
]) {
  test(name + ' opens a heading in the reading area', async () => {
    const p = page({ width, touch }); await p.flush();
    const content = p.cards[0].querySelector('.file-content');
    assert.equal(content.hidden, false);
    assert.equal(content.animations[0].options.duration, 500);
    assert.ok(content.animations[0].keyframes.every(frame => !('height' in frame) && !('transform' in frame)));
    assert.equal(p.cards[1].querySelector('.file-content').hidden, true);
  });
}

test('wide non-touch desktop retains manual opening', async () => {
  const p = page({ width: 1440, touch: false }); await p.flush();
  assert.equal(p.cards[0].querySelector('.file-content').hidden, true);
  p.cards[0].querySelector('.file-trigger').click();
  assert.equal(p.cards[0].querySelector('.file-content').hidden, false);
});

test('manual closing survives scrolling and tablet rotation', async () => {
  const p = page(); await p.flush();
  p.cards[0].querySelector('.file-trigger').click();
  p.resize(1366); p.window.emit('scroll'); await p.flush();
  assert.equal(p.cards[0].querySelector('.file-content').hidden, true);
});

test('entering tablet width enables automatic opening', async () => {
  const p = page({ width: 1440, touch: false }); await p.flush();
  p.resize(1024); await p.flush();
  assert.equal(p.cards[0].querySelector('.file-content').hidden, false);
});

test('headings outside reading area wait until scrolled into it', async () => {
  const p = page(); p.cards[0].querySelector('.file-trigger').top = 700;
  await p.flush(); assert.equal(p.cards[0].querySelector('.file-content').hidden, true);
  p.cards[0].querySelector('.file-trigger').top = 150;
  p.window.emit('scroll'); await p.flush();
  assert.equal(p.cards[0].querySelector('.file-content').hidden, false);
});

test('reduced motion opens tablet content without animation', async () => {
  const p = page({ reduced: true }); await p.flush();
  const content = p.cards[0].querySelector('.file-content');
  assert.equal(content.hidden, false); assert.equal(content.animations.length, 0);
});
