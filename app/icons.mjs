const paths = {
  inbox: '<path d="M3 4h14v12H3z"/><path d="M3 11h4l1.5 2h3l1.5-2h4"/>',
  runs: '<path d="M4 10a6 6 0 1 1 1.8 4.3"/><path d="M4 6v4h4"/>',
  dossiers: '<path d="M2.5 5.5h5l1.5 1.7h8.5v9.3h-15z"/><path d="M2.5 5.5V4h5l1.5 1.5"/>',
  config: '<path d="M3 6h14M3 10h14M3 14h14"/><circle cx="7" cy="6" r="1.5"/><circle cx="12" cy="10" r="1.5"/><circle cx="9" cy="14" r="1.5"/>',
  providers: '<rect x="3" y="5" width="14" height="10" rx="1.5"/><path d="M6 9h8M6 12h5"/>',
  internet: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3a11 11 0 0 1 0 14M10 3a11 11 0 0 0 0 14"/>',
  folder: '<path d="M2.5 5.5h5l1.5 1.7h8.5v9.3h-15z"/><path d="M2.5 5.5V4h5l1.5 1.5"/>',
  play: '<path d="m7 5 8 5-8 5z"/>',
  save: '<path d="M4 3.5h9l3 3v10H4z"/><path d="M7 3.5v5h6v-5M7 16.5v-5h6v5"/>',
  test: '<path d="M7 3h6M8.5 3v4l-4 7.5A1.7 1.7 0 0 0 6 17h8a1.7 1.7 0 0 0 1.5-2.5L11.5 7V3"/><path d="M6.5 12h7"/>',
  check: '<path d="m4 10 4 4 8-9"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  external: '<path d="M11 4h5v5M9 11l7-7"/><path d="M8 5H4v11h11v-4"/>',
  plus: '<path d="M10 3v14M3 10h14"/>',
  search: '<circle cx="9" cy="9" r="5.5"/><path d="m13.5 13.5 3.5 3.5"/>',
  trash: '<path d="M4 6h12M8 3h4l1 3M6 6l1 11h6l1-11"/>',
  versions: '<path d="M5 5h11M5 9h8M5 13h11M5 17h8"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7" cy="8" r="1.5"/><path d="m4 14 4-4 3 3 2-2 4 4"/>',
  story: '<path d="M5 3.5h8l2 2v11H5z"/><path d="M8 8h4M8 11h4M8 14h3"/>',
  menu: '<path d="M5 4v5a2 2 0 0 0 2 2V4M6 11v5M13 4v12M13 4c2 1 2 5 0 7"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${paths[name] ?? ''}</svg>`;
}
