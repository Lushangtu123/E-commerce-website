const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function createBrowser(storage = {}) {
  const values = new Map(Object.entries(storage));
  return {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
    window: { location: { href: '/current', origin: 'http://localhost:3000' } },
  };
}

function loadSource(relativePath, globals = {}, imports = {}) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (name) => Object.hasOwn(imports, name) ? imports[name] : require(name),
    process: { env: { NEXT_PUBLIC_API_URL: 'http://localhost:3001/api' } },
    console,
    URL,
    URLSearchParams,
    ...globals,
  }, { filename });
  return module.exports;
}

function loadApi(storage, apiUrl = 'http://localhost:3001/api') {
  const browser = createBrowser(storage);
  const exports = loadSource('src/lib/api.ts', { ...browser, process: { env: { NEXT_PUBLIC_API_URL: apiUrl } } });
  const requests = [];
  exports.default.defaults.adapter = async (config) => {
    requests.push(config);
    return { data: { data: [] }, status: 200, statusText: 'OK', headers: {}, config };
  };
  return { ...exports, ...browser, requests };
}

function loadStores(storage) {
  const browser = createBrowser(storage);
  const cartModule = loadSource('src/store/useCartStore.ts');
  const authModule = loadSource('src/store/useAuthStore.ts', browser, {
    '@/lib/logger': { logger: { error() {} } },
    '@/store/useCartStore': cartModule,
  });
  return { ...browser, ...cartModule, ...authModule };
}

function loadPage(relativePath, { initialState = {}, imports = {}, globals = {} } = {}) {
  const React = require('react');
  const hooks = [];
  const requests = [];
  const redirects = [];
  let hookIndex = 0;
  let pendingEffects = [];
  let auth;
  const api = new Proxy({}, {
    get: (_, name) => new Proxy({}, {
      get: (_, method) => async (...args) => {
        requests.push({ name, method, args });
        return { data: [], items: [], orders: [], favorites: [], history: [], pagination: { total: 0 }, order: { status: 3 } };
      },
    }),
  });
  const toast = { error() {}, success() {} };
  const Page = loadSource(relativePath, globals, {
    react: {
      ...React,
      useState(initial) {
        const index = hookIndex++;
        if (!hooks[index]) {
          hooks[index] = { value: Object.hasOwn(initialState, index) ? initialState[index] : typeof initial === 'function' ? initial() : initial };
        }
        return [hooks[index].value, (next) => {
          hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next;
        }];
      },
      useEffect(effect, dependencies) {
        const index = hookIndex++;
        const previous = hooks[index]?.dependencies;
        if (!previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
          pendingEffects.push(effect);
        }
        hooks[index] = { dependencies };
      },
    },
    'next/navigation': {
      useRouter: () => router,
      useParams: () => ({ id: '1' }),
    },
    'next/link': () => null,
    '@/store/useAuthStore': { useAuthStore: Object.assign((selector) => selector ? selector(auth) : auth, { getState: () => auth }) },
    '@/store/useCartStore': { useCartStore: () => ({ items: [], setItems() {}, updateQuantity() {}, removeItem() {}, clearCart() {}, getTotalPrice() {} }) },
    '@/lib/api': api,
    '@/lib/logger': { logger: { error() {} } },
    'react-hot-toast': { __esModule: true, default: toast, toast },
    ...imports,
  }).default;
  const router = { push: (path) => redirects.push(path) };
  return {
    requests,
    redirects,
    async render(nextAuth) {
      auth = nextAuth;
      hookIndex = 0;
      pendingEffects = [];
      const tree = Page({});
      pendingEffects.forEach((effect) => effect());
      await new Promise(setImmediate);
      return tree;
    },
  };
}

function findElements(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((child) => findElements(child, predicate));
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...findElements(tree.props.children, predicate),
  ];
}

module.exports = { createBrowser, loadSource, loadApi, loadStores, loadPage, findElements };
