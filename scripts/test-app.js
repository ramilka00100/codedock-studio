'use strict';

/**
 * Тесты CodeDock Studio без браузера: страница исполняется в Node
 * с минимальной DOM-заглушкой. Проверяются:
 *   — загрузка приложения и отрисовка;
 *   — сборка предпросмотра (вставка своих css/js на их места);
 *   — ZIP-выгрузка (сигнатура и центральный каталог);
 *   — нормализация проекта, CRC32;
 *   — правка файла, удаление с отменой, поиск и замена.
 *
 * Запуск: node scripts/test-app.js
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).pop();

const problems = [];
const check = (condition, message) => {
  if (!condition) problems.push(message);
};

/* ---------------------------------------------------------------- DOM ---- */
class ClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  toggle(name, force) {
    const state = force === undefined ? !this.values.has(name) : Boolean(force);
    if (state) this.values.add(name); else this.values.delete(name);
    return state;
  }
  contains(name) { return this.values.has(name); }
}

let elementSeq = 0;

class Element {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.id = '';
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.classList = new ClassList();
    this.style = { setProperty() {} };
    this.dataset = {};
    this.attributes = {};
    this._text = '';
    this._html = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.files = [];
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.scrollTop = 0;
    this.offsetWidth = 300;
    this._seq = ++elementSeq;
  }

  set className(value) { this.classList = new ClassList(); String(value).split(/\s+/).filter(Boolean).forEach((n) => this.classList.add(n)); }
  get className() { return [...this.classList.values].join(' '); }

  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text || this.children.map((child) => child.textContent).join(''); }

  set innerHTML(value) {
    this._html = String(value);
    this.children = [];
    this._text = '';
    // Плоский разбор разметки: создаём дочерние элементы с классами и data-атрибутами,
    // чтобы работали querySelector('.tab-close') и closest('button[data-action]').
    const tagRe = /<([a-zA-Z][\w-]*)([^>]*)>/g;
    let match;
    while ((match = tagRe.exec(this._html))) {
      const node = new Element(match[1]);
      const attrs = match[2] || '';
      const className = /class="([^"]*)"/.exec(attrs);
      if (className) className[1].split(/\s+/).filter(Boolean).forEach((name) => node.classList.add(name));
      const idAttr = /id="([^"]*)"/.exec(attrs);
      if (idAttr) node.id = idAttr[1];
      const dataRe = /data-([\w-]+)="([^"]*)"/g;
      let data;
      while ((data = dataRe.exec(attrs))) {
        const key = data[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        node.dataset[key] = data[2];
      }
      node.parentNode = this;
      this.children.push(node);
    }
  }
  get innerHTML() { return this._html; }

  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  prepend(child) { child.parentNode = this; this.children.unshift(child); }
  insertBefore(child, before) {
    const index = before ? this.children.indexOf(before) : this.children.length;
    child.parentNode = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }
  replaceWith(node) {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) {
      node.parentNode = this.parentNode;
      this.parentNode.children[index] = node;
    }
  }
  removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  focus() {}
  select() { this.selectionStart = 0; this.selectionEnd = String(this.value).length; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} });
  }
  getBoundingClientRect() { return { width: 200, height: 200, top: 0, left: 0 }; }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((item) => item !== handler));
  }
  dispatchEvent(event) {
    const prepared = event || {};
    prepared.target = prepared.target || this;
    let stopped = false;
    prepared.preventDefault = prepared.preventDefault || (() => {});
    prepared.stopPropagation = prepared.stopPropagation || (() => { stopped = true; });
    // События всплывают, как в браузере: обработчик строки должен получить клик по кнопке.
    let node = this;
    while (node && !stopped) {
      (node.listeners.get(prepared.type) || []).forEach((handler) => handler.call(node, prepared));
      node = node.parentNode;
    }
    return true;
  }

  querySelector(selector) {
    return findDeep(this, (node) => matches(node, selector)) || null;
  }
  querySelectorAll(selector) {
    const result = [];
    walk(this, (node) => { if (matches(node, selector)) result.push(node); });
    return result;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
}

function walk(node, visit) {
  node.children.forEach((child) => { visit(child); walk(child, visit); });
}

function findDeep(node, predicate) {
  let found = null;
  walk(node, (child) => { if (!found && predicate(child)) found = child; });
  return found;
}

function matches(node, selector) {
  if (!selector) return false;
  const attribute = /^([a-z]*)\[data-action(?:="([^"]*)")?\]$/i.exec(selector);
  if (attribute) {
    if (attribute[1] && node.tagName !== attribute[1].toUpperCase()) return false;
    if (!Object.prototype.hasOwnProperty.call(node.dataset, 'action')) return false;
    return attribute[2] === undefined || node.dataset.action === attribute[2];
  }
  if (selector.startsWith('.')) {
    const classes = selector.slice(1).split('.');
    return classes.every((name) => node.classList.contains(name));
  }
  if (selector === 'button') return node.tagName === 'BUTTON';
  if (/^[a-z]+$/i.test(selector)) return node.tagName === selector.toUpperCase();
  return false;
}

class DocumentStub {
  constructor(ids) {
    this.documentElement = new Element('html');
    this.body = new Element('body');
    this.listeners = new Map();
    this.registry = new Map();
    ids.forEach((id) => this.registry.set(id, this.createNode(id)));
  }
  createNode(id) {
    const node = new Element(id.includes('Btn') || id.includes('btn') ? 'button' : 'div');
    node.id = id;
    return node;
  }
  getElementById(id) {
    if (!this.registry.has(id)) this.registry.set(id, this.createNode(id));
    return this.registry.get(id);
  }
  createElement(tag) { return new Element(tag); }
  createDocumentFragment() { return new Element('fragment'); }
  querySelectorAll(selector) {
    if (selector === '.type-btn') {
      const file = new Element('button');
      file.dataset.type = 'file';
      file.classList.add('type-btn');
      const folder = new Element('button');
      folder.dataset.type = 'folder';
      folder.classList.add('type-btn');
      return [file, folder];
    }
    return [];
  }
  querySelector() { return null; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  dispatchEvent(event) {
    (this.listeners.get(event.type) || []).forEach((handler) => handler(event));
  }
}

/* ------------------------------------------------------------ sandbox ---- */
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
const document = new DocumentStub(ids);

const storage = new Map();
const localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)); },
  removeItem: (key) => { storage.delete(key); },
  clear: () => storage.clear(),
};

const historyStub = {
  entries: 0,
  pushState() { this.entries += 1; },
  replaceState() {},
  back() {},
};

const windowListeners = new Map();
const sandbox = {
  console,
  document,
  localStorage,
  history: historyStub,
  location: { href: 'https://example.test/codedock/', replace() {} },
  navigator: { userAgent: 'node' },
  setTimeout,
  clearTimeout,
  getComputedStyle: () => ({ lineHeight: '21px' }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  TextEncoder,
  Blob,
  URL: class extends URL {
    static createObjectURL() { return 'blob:mock'; }
    static revokeObjectURL() {}
  },
  Event: class { constructor(type) { this.type = type; } },
  crypto: { randomUUID: () => `id-${++elementSeq}` },
  matchMedia: () => ({ matches: false }),
  innerWidth: 390,
  innerHeight: 844,
  isSecureContext: true,
  addEventListener(type, handler) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(handler);
  },
  removeEventListener(type, handler) {
    windowListeners.set(type, (windowListeners.get(type) || []).filter((item) => item !== handler));
  },
  dispatchEvent(event) {
    (windowListeners.get(event.type) || []).forEach((handler) => handler(event));
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);

try {
  vm.runInContext(script, sandbox, { filename: 'codedock-inline.js' });
} catch (error) {
  problems.push(`Инициализация упала: ${error.stack.split('\n').slice(0, 3).join(' | ')}`);
}

/* -------------------------------------------------------------- tests ---- */
const api = sandbox.__codedock;
let zipBlob = null;

if (!api) {
  problems.push('window.__codedock не создан');
  console.log(`Проблемы (${problems.length}):`);
  problems.forEach((problem) => console.log(' -', problem));
  process.exit(1);
} else {
  check(api.version === '3.0.0', 'версия не 3.0.0');

  // CRC32 эталон: "123456789" -> 0xCBF43926
  const crc = api.crc32(new TextEncoder().encode('123456789'));
  check(crc === 0xCBF43926, `CRC32 неверный: ${crc.toString(16)}`);

  // Нормализация
  check(api.normalizeTree([{ id: 'a', name: 'a.js', type: 'file', content: 'x' }]) !== null, 'normalizeTree отверг валидное дерево');
  check(api.normalizeTree({}) === null, 'normalizeTree принял мусор');
  check(api.normalizeTree([{ name: 'a/b.js', type: 'file' }]) === null, 'normalizeTree пропустил слеш в имени');

  // Сборка предпросмотра
  const files = [
    { name: 'index.html', path: 'index.html', content: '<html><head><link rel="stylesheet" href="style.css"></head><body><h1>Hi</h1><script src="script.js"></script></body></html>' },
    { name: 'style.css', path: 'style.css', content: 'h1 { color: red; }' },
    { name: 'script.js', path: 'script.js', content: 'console.log(1)' },
  ];
  const preview = api.buildPreviewHtml(files);
  check(preview.includes('<style data-src="style.css">'), 'CSS не вставлен в предпросмотр');
  check(preview.includes('<script data-src="script.js">'), 'JS не вставлен в предпросмотр');
  check(preview.includes('codedock-console'), 'шим консоли не внедрён');
  check(preview.includes('h1 { color: red; }'), 'содержимое CSS потерялось');
  check(!preview.includes('href="style.css"'), 'старый link остался');
  check(preview.indexOf('codedock-console') < preview.indexOf('h1'), 'шим консоли должен быть в head');

  const noHtml = api.buildPreviewHtml([{ name: 'a.css', path: 'a.css', content: '' }]);
  check(noHtml.includes('index.html не найден'), 'нет заглушки для проекта без HTML');

  // ZIP
  const zip = api.zipStore([
    { name: 'index.html', path: 'index.html', content: 'hello' },
    { name: 'a.js', path: 'js/a.js', content: 'console.log(1)' },
  ]);
  zipBlob = zip;
  check(zip instanceof Blob, 'zipStore вернул не Blob');
  check(zip.size > 100, 'ZIP подозрительно маленький');
}

// Статические проверки исходника
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
const usedIds = new Set([
  ...[...script.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]),
  ...[...script.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]),
]);
for (const id of usedIds) {
  if (!htmlIds.has(id)) problems.push(`в скрипте используется отсутствующий id: ${id}`);
}
check(!/\balert\(/.test(script), 'остался alert()');
check(!/\bconfirm\(/.test(script), 'остался confirm()');
check(!script.includes('allow-same-origin'), 'в iframe остался allow-same-origin');
check(script.includes('unhandledrejection'), 'в шиме консоли нет unhandledrejection');
check(script.includes('scheduleSave'), 'нет отложенного сохранения');
check((script.match(/execCommand/g) || []).length === 1, 'execCommand остался в undo/redo');
check(html.includes('viewport-fit=cover'), 'нет viewport-fit=cover');
check(!html.includes('user-scalable=no'), 'остался user-scalable=no');

// Состояние приложения
const documentHtml = document.getElementById('tabsBar');
check(documentHtml.children.length > 0, 'вкладки не отрисованы');
check(document.getElementById('fileTree').children.length > 0, 'дерево не отрисовано');

const current = api.getFileSystem();
check(Array.isArray(current) && current.length === 4, 'демо-проект не загрузился');
check(sandbox.localStorage.getItem('codedock_v3') !== null, 'проект не сохранён в localStorage');

// Правка файла через событие input
const editor = document.getElementById('codeEditor');
editor.value = `${editor.value}\n// правка`;
editor.selectionStart = editor.value.length;
editor.selectionEnd = editor.value.length;
editor.dispatchEvent({ type: 'input' });

const edited = api.getFileSystem().find((item) => item.type === 'file' && item.content.includes('// правка'));
check(Boolean(edited), 'правка не попала в модель');

// Поиск и замена
sandbox.document.getElementById('searchBtn').click();
const searchInput = document.getElementById('searchInput');
searchInput.value = 'правка';
searchInput.dispatchEvent({ type: 'input' });
check(document.getElementById('searchCount').textContent !== '0/0', 'поиск не нашёл совпадение');

const replaceInput = document.getElementById('replaceInput');
replaceInput.value = 'изменение';
document.getElementById('replaceAll').click();
check(editor.value.includes('изменение'), 'замена всех не сработала в редакторе');
check(Boolean(edited) && edited.content.includes('изменение'), 'замена не попала в модель');

// Удаление и отмена
const before = api.getFileSystem().length;
const treeRoot = document.getElementById('fileTree');
const deleteButton = treeRoot.querySelector('[data-action="delete"]');
if (deleteButton) {
  deleteButton.click();
  check(api.getFileSystem().length < before, 'удаление не сработало');
  const toasts = document.getElementById('toastContainer').children;
  const toastNode = [...toasts].reverse().find((node) => node.children.some((child) => child.tagName === 'BUTTON'));
  const undoButton = toastNode && toastNode.children.find((child) => child.tagName === 'BUTTON');
  if (undoButton) {
    undoButton.click();
    check(api.getFileSystem().length === before, 'отмена удаления не восстановила файл');
  } else {
    const texts = toasts.map((node) => node.textContent.slice(0, 40));
    problems.push(`в тосте удаления нет кнопки отмены (тостов: ${texts.length}: ${texts.join(' | ')})`);
  }
} else {
  problems.push('в дереве нет кнопки удаления');
}

// Запуск проекта: собранный документ попадает в iframe
document.getElementById('runProjectBtn').click();
const srcdoc = document.getElementById('previewFrame').srcdoc;
check(document.getElementById('previewOverlay').classList.contains('open'), 'предпросмотр не открылся');
check(srcdoc.includes('sayHi'), 'в предпросмотр не попал script.js');
check(srcdoc.includes('.card'), 'в предпросмотр не попал style.css');
check(srcdoc.includes('codedock-console'), 'в предпросмотр не внедрена консоль');
check(!/<script[^>]*\ssrc="script\.js"/.test(srcdoc), 'в предпросмотре остался внешний script');

// Консоль: сообщение из iframe и красная точка при ошибке без открытой панели
sandbox.dispatchEvent({
  type: 'message',
  data: { type: 'codedock-console', logType: 'log', message: 'тест' },
});
check(document.getElementById('consoleOutput').children.length >= 1, 'консоль не приняла сообщение');
sandbox.dispatchEvent({
  type: 'message',
  data: { type: 'codedock-console', logType: 'error', message: 'бум', stack: 'Error: бум\n at x' },
});
check(document.getElementById('consoleDot').classList.contains('show'), 'нет индикатора ошибки в консоли');

// Настройки: размер шрифта сохраняется в ui-хранилище
const fontSelect = document.getElementById('fontSizeSelect');
fontSelect.value = '16';
fontSelect.dispatchEvent({ type: 'change' });
const uiStored = JSON.parse(sandbox.localStorage.getItem('codedock_ui_v3') || '{}');
check(uiStored.settings && uiStored.settings.fontSize === 16, 'настройки шрифта не сохраняются');

// Кнопка «Назад» закрывает верхнюю панель
document.getElementById('closePreviewBtn').click();
document.getElementById('openDrawerBtn').click();
check(document.getElementById('fileDrawer').classList.contains('open'), 'шторка не открылась');
sandbox.dispatchEvent({ type: 'popstate' });
check(!document.getElementById('fileDrawer').classList.contains('open'), '«Назад» не закрыла шторку');

// Итог
(async () => {
  if (!zipBlob) {
    problems.push('ZIP не создан');
  } else {
    const zipBytes = Buffer.from(await zipBlob.arrayBuffer());
  check(zipBytes.readUInt32LE(0) === 0x04034b50, 'ZIP: нет сигнатуры локального заголовка');
  const eocd = zipBytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  check(eocd > 0, 'ZIP: нет EOCD');
  if (eocd > 0) {
    const entries = zipBytes.readUInt16LE(eocd + 10);
    check(entries === 2, `ZIP: записей ${entries}, ждали 2`);
  }
  const nameLength = zipBytes.readUInt16LE(26);
  const dataStart = 30 + nameLength;
  const dataSize = zipBytes.readUInt32LE(18);
  const headerCrc = zipBytes.readUInt32LE(14);
  const data = zipBytes.subarray(dataStart, dataStart + dataSize);
  check(api.crc32(data) === headerCrc, 'ZIP: CRC данных не совпадает с заголовком');

  if (process.env.DUMP_ZIP) {
    fs.writeFileSync(path.join(ROOT, 'scripts', '.zip-test.zip'), zipBytes);
    console.log('ZIP сохранён для внешней проверки: scripts/.zip-test.zip');
  }
  }

  // Иконки: размеры должны совпадать с манифестом
  const expected = {
    'icon-192.png': 192,
    'icon-512.png': 512,
    'icon-maskable-512.png': 512,
    'apple-touch-icon-180.png': 180,
    'icon.png': 512,
  };
  for (const [name, size] of Object.entries(expected)) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) {
      problems.push(`нет файла ${name}`);
      continue;
    }
    const png = fs.readFileSync(file);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    check(width === size && height === size, `${name}: ${width}x${height}, ждали ${size}x${size}`);
  }

  // Манифест: иконки и обязательные поля
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  check(manifest.display === 'standalone', 'манифест: display не standalone');
  check(manifest.start_url && manifest.scope, 'манифест: нет start_url/scope');
  const purposes = manifest.icons.map((icon) => icon.purpose);
  check(purposes.includes('any') && purposes.includes('maskable'), 'манифест: нет any/maskable иконок');
  for (const icon of manifest.icons) {
    check(fs.existsSync(path.join(ROOT, icon.src)), `манифест ссылается на отсутствующий ${icon.src}`);
  }

  // Ссылки в HTML и service worker
  for (const href of ['manifest.json', 'sw.js', 'logo.png', 'icon-192.png', 'apple-touch-icon-180.png']) {
    check(html.includes(href), `index.html не ссылается на ${href}`);
  }
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  try {
    new vm.Script(sw, { filename: 'sw.js' });
  } catch (error) {
    problems.push(`sw.js: синтаксис — ${error.message}`);
  }
  check(sw.includes('codedock-v7'), 'sw.js: не тот номер версии кэша');

  if (problems.length) {
    console.log(`Проблемы (${problems.length}):`);
    problems.forEach((problem) => console.log(' -', problem));
    process.exit(1);
  }
  console.log('Все проверки CodeDock пройдены.');
  console.log(`Файлов в демо-проекте: ${api.getFileSystem().length}, версия: ${api.version}`);
  console.log(`ZIP: ${zipBlob ? zipBlob.size : 0} байт, записей 2, CRC совпадает.`);
})();
