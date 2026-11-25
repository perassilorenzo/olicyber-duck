/** Icone SVG coerenti, disegnate con lo stesso tratto (stroke 1.8, 24x24). */
const PATHS = {
  check: '<path d="m5 12 4 4L19 6" />',
  arrowRight: '<path d="M5 12h14m-6-6 6 6-6 6" />',
  alert: '<path d="M12 9v4m0 4h.01M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />',
  external: '<path d="M14 4h6v6m0-6-9 9M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />',
};

export function icon(name, className = '') {
  const path = PATHS[name] || '';
  return `<svg viewBox="0 0 24 24" aria-hidden="true"${className ? ` class="${className}"` : ''}>${path}</svg>`;
}
