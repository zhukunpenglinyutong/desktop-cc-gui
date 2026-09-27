/**
 * Colored file-type icons shared by file browsing surfaces (file tree, tabs).
 * Brand icons use fixed colors (work in light and dark themes);
 * outline icons follow currentColor.
 *
 * All icons are inline SVG string constants — no asset files, no requests,
 * no decode cost. Selection is a single map/set lookup per row.
 */

const svg16 = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none">${body}</svg>`;

const svg24 = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const FILE_SHAPE =
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>';

const icon_folder = svg24(
  '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
);

const icon_folder_open = svg24(
  '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
);

const icon_file = svg24(FILE_SHAPE);

const icon_file_text = svg24(
  `${FILE_SHAPE}<path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>`,
);

const icon_file_code = svg24(
  `${FILE_SHAPE}<path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/>`,
);

const badgeText = (bg: string, fg: string, label: string, fontSize?: number): string => {
  const size = fontSize ?? (label.length > 2 ? 5.5 : 7);
  const y = size <= 6 ? 10.5 : 10.9;
  return svg16(
    `<rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="${bg}"/><text x="8" y="${y}" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${size}" font-weight="700" fill="${fg}">${label}</text>`,
  );
};

const icon_js = badgeText('#F5DE19', '#33301C', 'JS');
const icon_ts = badgeText('#3178C6', '#FFFFFF', 'TS');
const icon_jsx = badgeText('#00D8FF', '#002C33', 'JSX');
const icon_tsx = badgeText('#3178C6', '#FFFFFF', 'TSX');
const icon_vue = badgeText('#41B883', '#35495E', 'Vue');

const icon_java = svg16(
  '<rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="#EA2D2E"/><path d="M4.5 6.5h5a2 2 0 0 1 2 2v1a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 4.5 9.5v-3Zm5 1.5h1.2a.8.8 0 0 1 .8.8v.2a.8.8 0 0 1-.8.8H9.5V8ZM4 12.5h7" stroke="#fff" stroke-width="1" stroke-linecap="round" fill="none"/><path d="M6 3.5c-.5.8.5 1.4 0 2m2.5-2c-.5.8.5 1.4 0 2" stroke="#FFC107" stroke-width="0.8" stroke-linecap="round"/>',
);

const icon_kotlin = svg16(
  '<rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="#0D0D11"/><polygon points="1.5,1.5 14.5,1.5 8,8 14.5,14.5 1.5,14.5" fill="#7F52FF"/><polygon points="1.5,14.5 8,8 14.5,14.5" fill="#C711E1"/>',
);

const icon_python = badgeText('#3776AB', '#FFD43B', 'Py');
const icon_rust = badgeText('#CE412B', '#FFFFFF', 'RS');
const icon_go = badgeText('#00ADD8', '#FFFFFF', 'GO');
const icon_c = badgeText('#659AD2', '#FFFFFF', 'C');
const icon_cpp = badgeText('#00599C', '#FFFFFF', 'C++');
const icon_cs = badgeText('#178600', '#FFFFFF', 'C#');
const icon_sql = badgeText('#E38C00', '#FFFFFF', 'SQL');
const icon_xml = badgeText('#E44D26', '#FFFFFF', 'XML');
const icon_php = badgeText('#777BB4', '#FFFFFF', 'PHP');
const icon_ruby = badgeText('#CC342D', '#FFFFFF', 'RB');
const icon_swift = badgeText('#F05138', '#FFFFFF', 'SW');
const icon_gradle = badgeText('#02303A', '#00C7B7', 'Gr');
const icon_properties = badgeText('#3E8E41', '#FFFFFF', 'prop');
const icon_docker = badgeText('#2496ED', '#FFFFFF', '🐳', 8);

const icon_json = svg16(
  '<path d="M6.1 2.4c-1.35 0-2 .68-2 2.02v1.5c0 .9-.45 1.5-1.5 1.72v.72c1.05.22 1.5.82 1.5 1.72v1.5c0 1.34.65 2.02 2 2.02" stroke="#D9A62E" stroke-width="1.25" stroke-linecap="round"/><path d="M9.9 2.4c1.35 0 2 .68 2 2.02v1.5c0 .9.45 1.5 1.5 1.72v.72c-1.05.22-1.5.82-1.5 1.72v1.5c0 1.34-.65 2.02-2 2.02" stroke="#D9A62E" stroke-width="1.25" stroke-linecap="round"/>',
);

const icon_git = svg16(
  '<rect x="3.1" y="3.1" width="9.8" height="9.8" rx="1.8" transform="rotate(45 8 8)" fill="#F05133"/><circle cx="8" cy="5.3" r="1.05" fill="#fff"/><circle cx="8" cy="10.7" r="1.05" fill="#fff"/><path d="M8 6.4v3.2" stroke="#fff" stroke-width="1"/>',
);

const icon_markdown = svg16(
  '<rect x="1" y="3.5" width="14" height="9" rx="1.8" fill="#57534E"/><path d="M3.2 10.1V5.9l1.9 2.2 1.9-2.2v4.2" stroke="#fff" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.3 5.9v4.2m0 0-1.5-1.6m1.5 1.6 1.5-1.6" stroke="#fff" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round"/>',
);

const icon_lock = svg16(
  '<rect x="3.6" y="7.1" width="8.8" height="6.3" rx="1.6" fill="#E3B341"/><path d="M5.6 7V5.3a2.4 2.4 0 0 1 4.8 0V7" stroke="#E3B341" stroke-width="1.4"/>',
);

const icon_image = svg16(
  '<rect x="2" y="2.75" width="12" height="10.5" rx="1.75" stroke="#4CAF50" stroke-width="1.2"/><circle cx="5.8" cy="6.4" r="1.15" fill="#4CAF50"/><path d="m3.9 12.9 3.3-3.7a.9.9 0 0 1 1.34 0l3.36 3.7" stroke="#4CAF50" stroke-width="1.2" stroke-linecap="round"/>',
);

const icon_eslint = svg16(
  '<path d="M8 1.6 13.6 4.8v6.4L8 14.4 2.4 11.2V4.8Z" fill="#4B32C3"/><path d="M8 4.7 10.9 6.35v3.3L8 11.3 5.1 9.65v-3.3Z" fill="#fff"/>',
);

const icon_nix = svg16(
  '<path d="M8 1.8v12.4M2.6 4.9l10.8 6.2M2.6 11.1 13.4 4.9" stroke="#7EBAE4" stroke-width="1.25" stroke-linecap="round"/>',
);

const icon_css = svg16(
  '<path d="M6.6 2.6 5 13.4M11 2.6 9.4 13.4M3.2 6h10.4M2.4 10h10.4" stroke="#4C97E4" stroke-width="1.25" stroke-linecap="round"/>',
);

const icon_html = svg16(
  '<path d="m5.6 4.6-3.2 3.4 3.2 3.4M10.4 4.6l3.2 3.4-3.2 3.4" stroke="#E44D26" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
);

const icon_shell = svg16(
  '<path d="m2.8 4.6 3.4 3.4-3.4 3.4" stroke="#4CAF50" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.4 11.4h4.8" stroke="#4CAF50" stroke-width="1.3" stroke-linecap="round"/>',
);

const icon_config = svg24(
  '<path d="M3 6h12M19 6h2M3 12h2M9 12h12M3 18h12M19 18h2"/><circle cx="17" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
);

const EXT_ICONS: Record<string, string> = {
  js: icon_js,
  jsx: icon_jsx,
  cjs: icon_js,
  mjs: icon_js,
  ts: icon_ts,
  tsx: icon_tsx,
  cts: icon_ts,
  mts: icon_ts,
  json: icon_json,
  jsonc: icon_json,
  json5: icon_json,
  md: icon_markdown,
  markdown: icon_markdown,
  mdx: icon_markdown,
  lock: icon_lock,
  nix: icon_nix,
  css: icon_css,
  scss: icon_css,
  sass: icon_css,
  less: icon_css,
  styl: icon_css,
  pcss: icon_css,
  postcss: icon_css,
  html: icon_html,
  htm: icon_html,
  vue: icon_vue,
  svelte: icon_html,
  astro: icon_html,
  sh: icon_shell,
  bash: icon_shell,
  zsh: icon_shell,
  fish: icon_shell,
  bat: icon_shell,
  cmd: icon_shell,
  ps1: icon_shell,
  yml: icon_config,
  yaml: icon_config,
  toml: icon_config,
  ini: icon_config,
  cfg: icon_config,
  conf: icon_config,
  properties: icon_properties,
  editorconfig: icon_config,
  java: icon_java,
  class: icon_java,
  jar: icon_java,
  kt: icon_kotlin,
  kts: icon_kotlin,
  py: icon_python,
  pyw: icon_python,
  rs: icon_rust,
  go: icon_go,
  c: icon_c,
  h: icon_c,
  cpp: icon_cpp,
  cc: icon_cpp,
  cxx: icon_cpp,
  hpp: icon_cpp,
  hxx: icon_cpp,
  cs: icon_cs,
  sql: icon_sql,
  xml: icon_xml,
  fxml: icon_xml,
  xsd: icon_xml,
  php: icon_php,
  rb: icon_ruby,
  swift: icon_swift,
  gradle: icon_gradle,
  png: icon_image,
  jpg: icon_image,
  jpeg: icon_image,
  gif: icon_image,
  webp: icon_image,
  ico: icon_image,
  bmp: icon_image,
  svg: icon_image,
  avif: icon_image,
};

/** Common code extensions (beyond brand icons) that fall back to the generic code icon. */
const CODE_EXTENSIONS = new Set([
  'py', 'rs', 'go', 'java', 'rb', 'php', 'c', 'h', 'cpp', 'hpp', 'cc',
  'cs', 'swift', 'kt', 'scala', 'sql', 'graphql', 'gql', 'prisma',
  'proto', 'lua', 'zig', 'ex', 'exs', 'erl', 'hs', 'ml', 'clj', 'dart',
  'r', 'jl', 'pl', 'vim', 'tf', 'hcl', 'gradle', 'cmake', 'nim', 'd',
]);

const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'csv', 'tsv', 'rtf', 'pdf', 'doc', 'docx', 'tex',
  'adoc', 'rst', 'org', 'epub',
]);

const CODE_FILE_NAMES = new Set([
  'makefile', 'dockerfile', 'jenkinsfile', 'gemfile', 'rakefile',
  'procfile', 'pipfile', 'gradlew',
]);

const TEXT_FILE_NAMES = new Set(['readme', 'license', 'licence', 'changelog']);

function getFileTreeFileIcon(fileName: string): string {
  const name = fileName.toLowerCase().replace(/:\d+(-\d+)?$/, '');
  if (name === '.git' || name.startsWith('.git')) {
    return icon_git;
  }
  if (name.endsWith('.lock') || name.endsWith('.lockb') || name.includes('-lock.')) {
    return icon_lock;
  }
  const ext = name.includes('.') ? name.split('.').pop() ?? '' : '';
  const extIcon = EXT_ICONS[ext];
  if (extIcon) {
    return extIcon;
  }
  if (name.startsWith('.eslint') || name.startsWith('eslint.config')) {
    return icon_eslint;
  }
  if (name === 'dockerfile' || name.startsWith('dockerfile.') || name.endsWith('.dockerfile')) {
    return icon_docker;
  }
  if (CODE_FILE_NAMES.has(name)) {
    return icon_file_code;
  }
  if (TEXT_FILE_NAMES.has(name)) {
    return icon_file_text;
  }
  if (CODE_EXTENSIONS.has(ext)) {
    return icon_file_code;
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return icon_file_text;
  }
  return icon_file;
}

/**
 * File tree node icon: folders use a gray outline (open variant when expanded),
 * files are colored by type.
 */
export function getFileTreeIconSvg(
  name: string,
  isFolder: boolean,
  isOpen: boolean = false,
): string {
  if (isFolder) {
    return isOpen ? icon_folder_open : icon_folder;
  }
  return getFileTreeFileIcon(name);
}
