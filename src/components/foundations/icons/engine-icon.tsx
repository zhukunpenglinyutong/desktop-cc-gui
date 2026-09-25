import { useId, type CSSProperties } from "react";
import SquareTerminal from "lucide-react/dist/esm/icons/square-terminal";
import claudeIcon from "@/assets/model-icons/claude.svg";
import deepseekIcon from "@/assets/model-icons/deepseek.svg";
import chatglmIcon from "@/assets/model-icons/chatglm.svg";
import qwenIcon from "@/assets/model-icons/qwen.svg";
import doubaoIcon from "@/assets/model-icons/doubao.svg";
import minimaxIcon from "@/assets/model-icons/minimax.svg";
import minimaxCodeIcon from "@/assets/model-icons/minimax-code.png";
import yiIcon from "@/assets/model-icons/yi.svg";
import baichuanIcon from "@/assets/model-icons/baichuan.svg";
import hunyuanIcon from "@/assets/model-icons/hunyuan.svg";
import stepfunIcon from "@/assets/model-icons/stepfun.svg";
import geminiIcon from "@/assets/model-icons/gemini.svg";
import mistralIcon from "@/assets/model-icons/mistral.svg";
import cohereIcon from "@/assets/model-icons/cohere.svg";
import perplexityIcon from "@/assets/model-icons/perplexity.svg";

import { HERMES_ICON_PATHS } from "./hermes-glyph";

/**
 * Per-CLI brand marks for the engine picker (ported from the previous
 * desktop-cc-gui demo's EngineIcon). Image marks (claude / dsh) are
 * static assets; the rest are monochrome glyphs that follow `currentColor`,
 * so they ride the theme like every other icon.
 */

export type EngineIconId =
  /** Model vendors as well as CLIs: the picker and the usage page badge a
   *  model with its vendor mark (GLM, Qwen, ...), falling back to a
   *  monogram for vendors we ship no art for. */
  | "chatglm"
  | "qwen"
  | "doubao"
  | "minimax"
  | "yi"
  | "baichuan"
  | "hunyuan"
  | "stepfun"
  | "gemini"
  | "mistral"
  | "cohere"
  | "perplexity"
  | "claude"
  | "codex"
  | "grok"
  | "kimi"
  | "pi"
  | "omp"
  | "dsh"
  | "agy"
  | "opencode"
  | "qoder"
  | "qoder-cn"
  | "hermes";

interface EngineIconProps {
  engine: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

interface SvgGlyphProps {
  size: number;
  className?: string;
  style?: CSSProperties;
}

const KIMI_ICON_PATHS = [
  "M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z",
  "M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z",
] as const;

const GROK_ICON_PATHS = [
  "M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815",
] as const;

const PI_ICON_PATHS = [
  "M1 1h16.5v11H12v5.5H6.5V23H1V1zm5.5 5.5V12H12V6.5H6.5z",
  "M17.5 12H23v11h-5.5V12z",
] as const;
/** OpenCode mark (opencode.ai): an outlined square frame — monochrome, so it
 *  rides `currentColor` like the other glyph icons. */
const OPENCODE_ICON_PATH = "M16 6H8v12h8V6zm4 16H4V2h16v20z";

const QODER_ICON_GREEN_PATH =
  "M23.376 14.458v-4.056c0-2.304-1.003-4.154-2.748-5.075L11.612.574l-.046.086-.045.086c1.68.886 2.644 2.673 2.644 4.902v4.056a7.928 7.928 0 01-.014.454l-.005.061c-.005.081-.01.164-.018.245a4.897 4.897 0 01-.011.1l-.01.076c-.008.068-.015.135-.025.203l-.018.113-.01.058a9.99 9.99 0 01-.098.513l-.007.03a7.209 7.209 0 01-.074.294l-.024.086c-.027.099-.056.197-.087.296l-.027.085a9.592 9.592 0 01-.111.323l-.033.085-.018.046c-.032.082-.064.166-.098.248-.019.048-.04.096-.061.145l-.007.017a6 6 0 01-.084.187c-.024.056-.05.11-.077.165-.03.061-.058.122-.089.182a9.423 9.423 0 01-.176.332c-.03.056-.062.111-.094.167-.031.053-.062.108-.095.16-.033.055-.066.11-.101.164-.033.053-.065.104-.1.155-.034.055-.07.107-.111.169l-.099.144a15.193 15.193 0 01-.34.457c-.04.05-.08.102-.121.151l-.107.128-.007.008a6.987 6.987 0 01-.262.298l-.149.16-.116.12a9.562 9.562 0 01-.204.198l-.03.03-.072.069a9.05 9.05 0 01-.263.235l-.025.022-.029.026-.042.035a11.7 11.7 0 01-.22.18l-.07.055-.018.013a8.904 8.904 0 01-.194.146c-.029.02-.057.042-.086.063a7.7 7.7 0 01-.22.152l-.057.04a8.865 8.865 0 01-.293.185l-.062.037a10.424 10.424 0 01-.307.173l-.037.02-.196.103-.108.052-.012.006a6.196 6.196 0 01-.315.143c-.065.028-.13.054-.196.08l-.035.014-.086.034c-.07.026-.143.05-.215.075l-.039.014-.064.023a8.056 8.056 0 01-.323.097l-.63.173a7.285 7.285 0 01-.33.08l-.07.015c-.053.012-.104.023-.157.032l-.065.011-.085.015a2.332 2.332 0 01-.194.027l-.085.01a4.715 4.715 0 01-.16.018l-.034.003a4.861 4.861 0 01-.246.016h-.033a2.714 2.714 0 01-.155.005h-.106a3.384 3.384 0 01-.225-.007H4.86l-.15-.012-.066-.006a5.586 5.586 0 01-.187-.02l-.04-.005a5.14 5.14 0 01-.219-.035l-.054-.01a6.943 6.943 0 01-.347-.082l-.03-.008-.038-.01a5.034 5.034 0 01-.269-.086l-.063-.023a4.216 4.216 0 01-.188-.073l-.071-.031-.016-.007a4.959 4.959 0 01-.16-.074l-.026-.013a.164.164 0 00-.014-.007l-.671-.351.486.486h.016l8.995 4.742.093.048.03.014.02.01c.056.026.111.052.169.076l.016.008.073.032.195.076.022.008a.718.718 0 01.03.012l.014.004a4.693 4.693 0 00.323.1l.027.007c.073.02.147.038.22.055l.018.004.027.006.066.013.088.016c.075.014.15.026.226.038l.042.004c.064.009.128.016.193.022l.126.012.06.003.05.002.098.005c.046.002.094.002.14.003h.12c.05 0 .1-.002.161-.005h.033l.07-.004a6.17 6.17 0 00.184-.014l.033-.003a.753.753 0 00.058-.005l.108-.012.081-.01.08-.01.129-.021.082-.014.071-.012c.054-.01.107-.021.16-.033l.066-.013.059-.013c.096-.022.192-.046.287-.073l.63-.172a7.354 7.354 0 00.397-.122l.04-.015c.075-.025.149-.051.222-.078.032-.011.062-.024.093-.037l.03-.012c.067-.027.135-.054.2-.082l.128-.056.195-.09.021-.01.102-.05c.068-.034.135-.069.202-.105l.037-.02.073-.038c.08-.044.16-.092.24-.139l.026-.015a8.086 8.086 0 00.322-.2l.065-.045 1.98.902a1.748 1.748 0 002.472-1.59v-7.33l.004.004z";
const QODER_ICON_DETAIL_PATH =
  "M11.617.576a3.904 3.904 0 00-.093-.047c-.016-.009-.033-.016-.05-.024a5.854 5.854 0 00-.166-.077l-.09-.04a4.094 4.094 0 00-.194-.074c-.017-.006-.035-.015-.053-.02l-.013-.005a5.18 5.18 0 00-.277-.088l-.07-.019a4.034 4.034 0 00-.219-.053c-.015-.003-.03-.008-.044-.012L10.253.1l-.057-.011a5.177 5.177 0 00-.225-.036L9.928.047a5.972 5.972 0 00-.191-.022L9.669.02a1.33 1.33 0 00-.058-.005L9.515.009a4.058 4.058 0 00-.111-.005C9.354 0 9.304 0 9.254 0h-.109c-.052 0-.106.004-.16.004L8.884.01A5.32 5.32 0 008.7.022l-.083.006h-.008c-.05.005-.1.013-.15.019l-.12.014c-.056.008-.112.018-.169.028-.037.006-.074.011-.11.018a7.054 7.054 0 00-.572.133l-.63.172c-.111.031-.22.064-.33.1-.037.011-.072.025-.108.037a12.91 12.91 0 00-.345.126c-.067.027-.133.054-.2.083l-.128.055a11.916 11.916 0 00-.318.15 7.376 7.376 0 00-.311.163c-.082.045-.16.092-.24.14a9.424 9.424 0 00-.35.218l-.016.01-.06.04a9.242 9.242 0 00-.51.37 12.54 12.54 0 00-.315.254l-.043.034-.01.007-.045.041c-.09.078-.18.158-.268.24l-.106.101c-.07.067-.139.135-.207.204l-.056.054-.063.067-.153.164-.12.133-.148.17c-.024.03-.049.057-.073.086l-.043.053a5.96 5.96 0 00-.123.155l-.118.151c-.04.053-.08.106-.118.16l-.075.101-.038.056-.107.155-.11.164a9.91 9.91 0 00-.168.265c-.012.02-.023.043-.037.063a12.43 12.43 0 00-.192.335l-.09.168c-.019.034-.04.07-.057.105-.011.022-.02.043-.032.065l-.092.188-.08.167a19.15 19.15 0 00-.083.192c-.017.038-.035.076-.05.115-.008.016-.014.034-.021.051-.035.083-.067.167-.1.253l-.051.134c-.04.11-.077.22-.113.33l-.02.057c0 .002 0 .005-.002.007l-.008.026c-.032.1-.06.2-.09.301l-.023.089c-.027.1-.052.2-.075.301l-.007.03a7.63 7.63 0 00-.057.267l-.008.048c-.015.074-.026.148-.038.223L.082 8.4c-.011.078-.02.156-.029.234-.006.051-.013.103-.017.154a6.57 6.57 0 00-.02.26c-.003.044-.007.086-.009.13-.004.128-.007.257-.007.386v4.056c0 1.478.42 2.741 1.138 3.692A4.75 4.75 0 002.73 18.67l9.015 4.753c-1.656-.874-2.728-2.685-2.73-5.051v-4.056c0-.13.004-.26.01-.39.002-.043.006-.085.01-.128.005-.088.01-.174.019-.261l.017-.155c.01-.077.018-.155.029-.234l.026-.164c.013-.074.025-.15.039-.223.02-.105.04-.21.064-.313l.008-.031c.023-.1.048-.201.075-.301l.023-.088c.028-.1.058-.202.09-.302l.008-.025.021-.063c.036-.11.073-.22.113-.33l.052-.134c.031-.085.065-.169.1-.253.022-.056.047-.111.07-.166a13.856 13.856 0 01.164-.358c.03-.063.06-.126.092-.188l.088-.172a9.22 9.22 0 01.187-.338l.096-.164c.034-.057.069-.112.104-.168l.1-.159a10.49 10.49 0 01.567-.786l.123-.155.116-.139c.05-.057.098-.115.148-.171a14.092 14.092 0 01.272-.297 9.706 9.706 0 01.432-.425c.088-.083.177-.163.268-.241l.054-.048a10.08 10.08 0 01.553-.435l.092-.068c.075-.053.15-.105.226-.156.019-.013.038-.028.06-.04a9.18 9.18 0 01.362-.227c.08-.047.16-.094.241-.139l.11-.058a7.643 7.643 0 01.521-.256l.126-.056a7.509 7.509 0 01.546-.208l.107-.037c.11-.036.22-.069.33-.1l.63-.172c.095-.026.191-.05.287-.072l.097-.02c.062-.014.125-.029.187-.04l.114-.018c.055-.01.11-.02.166-.028.04-.006.08-.01.12-.014.053-.007.105-.014.157-.019l.083-.006c.061-.005.123-.01.184-.013.034-.003.067-.003.101-.004l.16-.006h.11a3.187 3.187 0 01.261.008l.153.01.067.007c.064.006.128.013.192.022l.043.005a5.232 5.232 0 01.281.047l.141.03c.073.016.146.035.218.053l.07.019c.094.026.187.055.278.087l.067.025a4.326 4.326 0 01.449.19l.143.072L11.617.576z";

/**
 * Official omp mark from omp.sh: a π filled with the brand gradient
 * (pink → violet → cyan, oklch stops verbatim from the site). Unlike the
 * monochrome glyphs it ships its own colors, so it renders identically in
 * both themes. The gradient id is per-instance via useId — multiple omp
 * icons on one page must not share a defs id.
 */
function OmpGlyph({ size, className, style }: SvgGlyphProps) {
  // useId emits ":rN:"; colons break url(#…) fragment refs in WebKit.
  const gradientId = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      style={{ width: size, height: size, flexShrink: 0, ...style }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.7 0.24 340)" />
          <stop offset=".5" stopColor="oklch(0.62 0.21 295)" />
          <stop offset="1" stopColor="oklch(0.81 0.14 200)" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z"
      />
    </svg>
  );
}
/**
 * Qoder CLI mark: two-color by design — the brand green (#2ADB5C) is fixed,
 * the detail path follows `currentColor` so it stays readable in dark mode.
 * An <img> asset can't reach the page's currentColor, hence the inline glyph
 * (same reasoning as OmpGlyph).
 */
function QoderGlyph({ size, className, style }: SvgGlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      style={{ width: size, height: size, flexShrink: 0, ...style }}
      aria-hidden
    >
      <path fill="#2ADB5C" fillRule="evenodd" d={QODER_ICON_GREEN_PATH} />
      <path fill="currentColor" fillRule="evenodd" d={QODER_ICON_DETAIL_PATH} />
    </svg>
  );
}

const OPENAI_ICON_PATH =
  "M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 0 0-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 0 1 .476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 0 1 4.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 0 1-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 0 0 5.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0 0 10.205 0a5.947 5.947 0 0 0-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 0 0 4.162 1.713z";

function MonochromeGlyph({
  size,
  className,
  style,
  paths,
}: SvgGlyphProps & { paths: readonly string[] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      className={className}
      style={{ width: size, height: size, flexShrink: 0, ...style }}
      aria-hidden
    >
      {paths.map((pathData) => (
        <path key={pathData} d={pathData} />
      ))}
    </svg>
  );
}

/** Static brand marks rendered as <img> (engine → asset + accessible label). */
const RASTER_ICONS: Partial<Record<EngineIconId, { src: string; alt: string }>> = {
  claude: { src: claudeIcon, alt: "Claude" },
  chatglm: { src: chatglmIcon, alt: "GLM" },
  qwen: { src: qwenIcon, alt: "Qwen" },
  doubao: { src: doubaoIcon, alt: "Doubao" },
  minimax: { src: minimaxIcon, alt: "MiniMax" },
  yi: { src: yiIcon, alt: "Yi" },
  baichuan: { src: baichuanIcon, alt: "Baichuan" },
  hunyuan: { src: hunyuanIcon, alt: "Hunyuan" },
  stepfun: { src: stepfunIcon, alt: "StepFun" },
  gemini: { src: geminiIcon, alt: "Gemini" },
  mistral: { src: mistralIcon, alt: "Mistral" },
  cohere: { src: cohereIcon, alt: "Cohere" },
  perplexity: { src: perplexityIcon, alt: "Perplexity" },
  dsh: { src: deepseekIcon, alt: "DeepSeek Harness" },
  agy: { src: geminiIcon, alt: "Antigravity CLI" },
};

/** Monochrome glyphs drawn from path data, following `currentColor`. */
const MONOCHROME_ICONS: Partial<Record<EngineIconId, readonly string[]>> = {
  codex: [OPENAI_ICON_PATH],
  grok: GROK_ICON_PATHS,
  kimi: KIMI_ICON_PATHS,
  pi: PI_ICON_PATHS,
  opencode: [OPENCODE_ICON_PATH],
  hermes: HERMES_ICON_PATHS,
};

export function EngineIcon({ engine, size = 14, className, style }: EngineIconProps) {
  const iconStyle: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    ...style,
  };

  if (engine === "omp") {
    return <OmpGlyph size={size} className={className} style={style} />;
  }
  if (engine === "qoder" || engine === "qoder-cn") {
    return <QoderGlyph size={size} className={className} style={style} />;
  }
  // The MiniMax Code CLI wears the app's own blue badge (converted from the
  // shipped .icns); the flat `minimax` mark below stays for model-vendor
  // inference on other engines.
  if (engine === "minimax") {
    return (
      <img
        src={minimaxCodeIcon}
        alt="MiniMax Code"
        className={className}
        style={iconStyle}
        aria-hidden
      />
    );
  }

  const raster = RASTER_ICONS[engine as EngineIconId];
  if (raster) {
    return (
      <img src={raster.src} alt={raster.alt} className={className} style={iconStyle} aria-hidden />
    );
  }

  const paths = MONOCHROME_ICONS[engine as EngineIconId];
  if (paths) {
    return <MonochromeGlyph paths={paths} size={size} className={className} style={style} />;
  }

  return <SquareTerminal className={className} style={iconStyle} aria-hidden />;
}
