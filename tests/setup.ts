if (typeof window !== 'undefined') {
  const originalGetComputedStyle = window.getComputedStyle.bind(window);

  Object.defineProperty(window, 'getComputedStyle', {
    configurable: true,
    value: (element: Element, _pseudoElement?: string | null) => originalGetComputedStyle(element),
  });
}
