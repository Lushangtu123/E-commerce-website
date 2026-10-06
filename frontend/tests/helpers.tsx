import { act } from '@testing-library/react';
import { Profiler, useRef, type ReactNode } from 'react';

export function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** An axios-style rejection carrying a server error message. */
export function apiError(error: string, field: 'error' | 'message' = 'error') {
  return Object.assign(new Error(error), { response: { data: { [field]: error } } });
}

/** Let pending promise chains finish and React commit what they set, several hops deep. */
export async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i += 1) {
    await act(() => new Promise(resolve => setTimeout(resolve, 0)));
  }
}

/**
 * Dispatch several clicks before React re-renders, so later handlers still close
 * over the earlier render: a double click, or a click landing on a stale row.
 */
export function clickTogether(...elements: HTMLElement[]) {
  act(() => elements.forEach(element => element.click()));
}

/** Submit several forms before React re-renders (see clickTogether). */
export function submitTogether(...forms: HTMLFormElement[]) {
  act(() => forms.forEach(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))));
}

/**
 * Reads an event handler from the props React rendered onto an element, via React's
 * internal `__reactProps$` field. Only for cases the DOM cannot express: running a handler
 * from an earlier render (a real event always reaches the latest one), or passing a value
 * no rendered control can produce, such as a select option that does not exist.
 */
export function reactHandler(element: Element, name: 'onClick' | 'onChange' | 'onSubmit') {
  // Every node under one root shares the field name; happy-dom hides it from Object.keys on a <select>.
  let key: string | undefined;
  for (let node: Element | null = element; node && !key; node = node.parentElement) {
    key = Object.keys(node).find(field => field.startsWith('__reactProps$'));
  }
  const props = key && (element as unknown as Record<string, Record<string, ((event: unknown) => unknown) | undefined> | undefined>)[key];
  if (!props) throw new Error('Element was not rendered by React');
  const handler = props[name];
  if (!handler) throw new Error(`Element has no ${name} handler`);
  return handler;
}

/**
 * Captures an element's current handler; calling it later runs that render's closure. Only
 * the synchronous part runs inside act, and the handler's promise is returned as is, so a
 * handler waiting on a pending request never holds an act scope open. Wrap the call in
 * `await act(() => handler())` when its later state updates should be awaited.
 */
export function captureHandler(element: Element, name: 'onClick' | 'onChange' | 'onSubmit' = 'onClick') {
  const handler = reactHandler(element, name);
  return () => {
    let result: unknown;
    act(() => { result = handler({ preventDefault() {}, stopPropagation() {} }); });
    return Promise.resolve(result);
  };
}

/**
 * Records the DOM after every commit in its subtree, before that commit's useEffect
 * callbacks run (Profiler.onRender fires in the layout phase). Asserting on a snapshot
 * proves what the user could see and click before any effect cleaned up.
 */
export function CommitLog({ children, commits }: { children: ReactNode; commits: HTMLElement[] }) {
  const root = useRef<HTMLDivElement>(null);
  const record = () => {
    if (root.current) commits.push(root.current.cloneNode(true) as HTMLElement);
  };
  return <div ref={root}><Profiler id="commit-log" onRender={record}>{children}</Profiler></div>;
}
