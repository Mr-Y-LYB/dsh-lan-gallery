/**
 * 最小 React 替身：只为在 Node 里执行组件函数体。
 * 目的不是渲染出 DOM，而是让 useState/useCallback 这类调用真实发生，
 * 从而暴露 TDZ、未定义变量、非法 hook 顺序这类运行期错误。
 */

export const version = "18.0.0-fake";

const slots = [];
let cursor = 0;

export function resetHooks() {
  cursor = 0;
  slots.length = 0;
}

export function createElement(type, props, ...children) {
  return { type, props: props || {}, children };
}

export function useState(initial) {
  const index = cursor++;
  if (!(index in slots)) {
    slots[index] = typeof initial === "function" ? initial() : initial;
  }
  return [slots[index], (next) => { slots[index] = next; }];
}

export function useRef(initial) {
  const index = cursor++;
  if (!(index in slots)) slots[index] = { current: initial };
  return slots[index];
}

export function useCallback(fn) {
  cursor++;
  return fn;
}

export function useEffect() {
  cursor++;
}

export function useMemo(fn) {
  cursor++;
  return fn();
}

export class Component {
  constructor(props) {
    this.props = props;
    this.state = {};
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
  }
}

export default {
  version,
  createElement,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  Component,
};
