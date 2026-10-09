export type ThreadAction = "pin" | "rename" | "archive" | "delete";

export interface AiChatThread {
  id?: string;
  label: string;
  /** CLI engine id — brand mark rendered left of the label. */
  engine?: string;
  /** Relative-time chip (e.g. "34m"). */
  time: string;
  isSelected?: boolean;
  pinned?: boolean;
  /** A turn is streaming in this session — breathing blue dot unless retrying. */
  streaming?: boolean;
  /** Provider backoff is active; keep the running dot visible but static. */
  retrying?: boolean;
  unseen?: boolean;
  /** Pending tab: first message not sent, so pin/rename/copy-id do not apply. */
  isDraft?: boolean;
}

export interface AiChatRepo {
  id?: string;
  /** Workspace path — the git store's status cache is keyed by it (worktree
   *  child rows read dirty counts through this). */
  path?: string;
  label: string;
  /** 工作区多目录的附加根(不含主目录 `path`);absent/空 = 单目录。仅用于
   *  侧栏的多根标识与 Git/终端按根分组,不改变 `path` 的主目录语义。
   *  `buildRepo` 恒填充;可选以让不关心多根的构造点(如测试夹具)省略。 */
  roots?: string[];
  /** Original workspace folder name when `label` is a user-set alias
   *  (surfaced as the row tooltip). */
  originalLabel?: string;
  /** Recent chats listed when the repo is expanded. */
  threads: AiChatThread[];
  /** Max threads listed before collapsing behind a "show more" row. */
  threadLimit?: number;
  /** Plugin-provided badge text (e.g. "WSL") rendered as a chip after the
   *  label; styling comes from the plugin's injected CSS. */
  labelSuffix?: string;
  /** Expanded on first render (folder-open icon + visible threads). */
  defaultOpen?: boolean;
  /** Worktree child workspaces attached under this repo, each carrying its
   *  own threads; rendered as a WORKTREES group inside the expanded area. */
  worktrees?: AiChatRepo[];
  /** Set on a repo that IS a worktree child row. */
  worktree?: AiChatWorktreeMeta;
}

/** Worktree child metadata on a repo row (set when this repo IS a worktree
 *  child): branch label + PR badge data, from workspace meta. */
export interface AiChatWorktreeMeta {
  branch: string;
  prNumber?: number;
}

/** A workspace group section (工作区二级分类): named groups render with a
 *  collapsible header; the single `id: null` section is ungrouped repos
 *  rendered flat, exactly as before groups existed. */
export interface AiChatRepoSection {
  id: string | null;
  name: string;
  repos: AiChatRepo[];
}
