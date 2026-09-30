import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ArrowDown from "lucide-react/dist/esm/icons/arrow-down";
import Bot from "lucide-react/dist/esm/icons/bot";
import Clock from "lucide-react/dist/esm/icons/clock";
import MessageSquare from "lucide-react/dist/esm/icons/message-square";
import MessageSquarePlus from "lucide-react/dist/esm/icons/message-square-plus";
import Monitor from "lucide-react/dist/esm/icons/monitor";
import Users from "lucide-react/dist/esm/icons/users";
import { Chip } from "@/components/base/chips/chip";
import { cx } from "@/utils/cx";
import { BotAvatarView } from "@/features/bots/bot-avatar";
import type { BotAvatar } from "@/lib/ipc";

/**
 * 「即将支持」四个分区里的概念图：抽象流程图（方框 + 箭头），节点用与
 * 任务画布节点同一套外观（圆角、边框、字号层级、状态色 token），所以读起来
 * 像我们的界面，而不是一张贴进来的通用流程图。
 *
 * 全部只读：没有按钮、没有输入框、没有 hover 与点击态。功能没实现之前不画
 * 能点的东西——一个看起来能按的开关比一句「即将支持」更容易被当成 bug。
 * 因此这里也不放 `Switch` 这类真控件，只用 `Chip`（无 `onClick` 时它自己就是
 * 纯展示的 `<span>`）展示限制与状态。
 */

/** 概念图能画的分区：也是「还没做完」的页签清单。文案与页签标签共用同一份，
 *  避免同一个东西写两遍。记忆已上线（真实面板在 memory-section.tsx），不再
 *  属于这里。 */
export const PLANNED_TABS = ["runtime", "routines", "collab"] as const;
export type PlannedTabId = (typeof PLANNED_TABS)[number];

/** 这个页签是否属于「即将支持」的四个分区。 */
export function isPlannedTab(id: string): id is PlannedTabId {
  return (PLANNED_TABS as readonly string[]).includes(id);
}

/** 页签与分区标题的文案（页签标签本身就是分区标题）。 */
export const PLANNED_TAB_COPY: Record<
  PlannedTabId,
  { titleKey: string; descKey: string }
> = {
  runtime: { titleKey: "settings.botTabRuntime", descKey: "settings.botRuntimeDesc" },
  routines: { titleKey: "settings.botTabRoutines", descKey: "settings.botRoutinesDesc" },
  collab: { titleKey: "settings.botTabCollab", descKey: "settings.botCollabDesc" },
};

/** 流程图里一个环节：图标 + 标题 + 一行说明。 */
function Step({
  icon,
  title,
  note,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-center gap-2.5 rounded-lg border border-border-button-default bg-background-secondary-default px-3 py-2.5",
        className,
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background-primary-default text-text-tertiary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-2-medium text-text-primary">{title}</span>
        {note && (
          <span className="mt-0.5 block text-caption-1-regular text-text-tertiary">
            {note}
          </span>
        )}
      </span>
    </div>
  );
}

/** 环节之间的向下箭头。`pl-[19px]` 让它对齐上方卡片的图标列（卡片内边距
 *  12px + 图标 28px 的一半 − 箭头 14px 的一半），看着像一条竖线穿下来。 */
function Down({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-1.5 py-1 pl-[19px]">
      <ArrowDown className="size-3.5 shrink-0 text-text-quaternary" aria-hidden />
      {label && (
        <span className="text-caption-1-regular text-text-quaternary">{label}</span>
      )}
    </div>
  );
}

/** 枚举卡片：一个环节里并列的几种情况（三个后端 / 两个账本 / 几个子 Bot）。
 *  行首圆点表示就绪状态：实心=已具备，空心=还没有。 */
function Options({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: Array<{ label: string; note: string; ready: boolean }>;
  footer?: string;
}) {
  return (
    <div className="rounded-lg border border-border-button-default bg-background-secondary-default px-3 py-2.5">
      <p className="text-body-2-medium text-text-primary">{title}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-start gap-2">
            <span
              aria-hidden
              className={cx(
                "mt-[5px] size-1.5 shrink-0 rounded-full",
                row.ready
                  ? "bg-status-green-text"
                  : "border border-border-button-default",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="text-body-2-regular text-text-secondary">{row.label}</span>
              <span className="ml-2 text-caption-1-regular text-text-tertiary">
                {row.note}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {footer && (
        <p className="mt-2 border-t border-separator-border pt-2 text-caption-1-regular text-text-quaternary">
          {footer}
        </p>
      )}
    </div>
  );
}

/** 并排两个环节（两条写入路径 / 两个账本 / 几个子 Bot）。 */
function Pair({ children }: { children: ReactNode }) {
  return <div className="flex items-stretch gap-2">{children}</div>;
}

/** 一个窄节点：并排出现时用，标题居中、没有图标列。 */
function Mini({ icon, label, note }: { icon: ReactNode; label: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg border border-border-button-default bg-background-secondary-default px-2 py-2.5 text-center">
      <span className="text-text-tertiary">{icon}</span>
      <span className="text-body-2-regular text-text-primary">{label}</span>
      {note && (
        <span className="text-caption-1-regular text-text-tertiary">{note}</span>
      )}
    </div>
  );
}

const ICON = "size-4";

/** 运行后端：一份人格，三种后端，结果回到同一个会话。 */
function RuntimeConcept({ avatar, name }: ConceptBot) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col">
      <Step
        icon={<BotAvatarView avatar={avatar} seed={name} size={18} />}
        title={name}
        note={t("settings.botConceptRuntimeIdentity")}
      />
      <Down label={t("settings.botConceptRuntimePick")} />
      <Options
        title={t("settings.botConceptRuntimeBackends")}
        footer={t("settings.botConceptRuntimeDetect")}
        rows={[
          {
            label: t("settings.botConceptRuntimeDirect"),
            note: t("settings.botConceptRuntimeDirectNote"),
            ready: true,
          },
          {
            label: "Claude Code",
            note: t("settings.botConceptRuntimeCliNote"),
            ready: true,
          },
          {
            label: "Codex",
            note: t("settings.botConceptRuntimeMissingNote"),
            ready: false,
          },
        ]}
      />
      <Down label={t("settings.botConceptRuntimeSame")} />
      <Step
        icon={<MessageSquare className={ICON} aria-hidden />}
        title={t("settings.botConceptRuntimeSink")}
        note={t("settings.botConceptRuntimeSinkNote")}
      />
    </div>
  );
}

/** 定时任务：到点、客户端在不在、跑一次、结果回聊天。 */
function RoutinesConcept() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col">
      <Step
        icon={<Clock className={ICON} aria-hidden />}
        title={t("settings.botConceptRoutineTick")}
        note={t("settings.botConceptRoutineTickNote")}
      />
      <Down />
      <Step
        icon={<Monitor className={ICON} aria-hidden />}
        title={t("settings.botConceptRoutineRunning")}
        note={t("settings.botConceptRoutineRunningNote")}
      />
      <Down label={t("settings.botConceptRoutineRun")} />
      <Step
        icon={<MessageSquarePlus className={ICON} aria-hidden />}
        title={t("settings.botConceptRoutineSession")}
        note={t("settings.botConceptRoutineSessionNote")}
      />
      <Down />
      <Step
        icon={<MessageSquare className={ICON} aria-hidden />}
        title={t("settings.botConceptRoutineResult")}
        note={t("settings.botConceptRoutineResultNote")}
      />
    </div>
  );
}

/** 协作：委派出去、子 Bot 自己干活、结果回主 Bot；另有群聊。 */
function CollabConcept() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col">
      <Step
        icon={<Bot className={ICON} aria-hidden />}
        title={t("settings.botConceptCollabMain")}
        note={t("settings.botConceptCollabMainNote")}
      />
      <Down label="delegate_task" />
      <Pair>
        <Mini icon={<Bot className={ICON} aria-hidden />} label={t("settings.botConceptCollabChild")} />
        <Mini icon={<Bot className={ICON} aria-hidden />} label={t("settings.botConceptCollabChild")} />
        <Mini icon={<Bot className={ICON} aria-hidden />} label={t("settings.botConceptCollabChild")} />
      </Pair>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-3.5">
        <span className="text-caption-1-regular text-text-tertiary">
          {t("settings.botConceptCollabChildNote")}
        </span>
        <Chip>{t("settings.botConceptCollabLimits")}</Chip>
      </div>
      <Down label={t("settings.botConceptCollabReturn")} />
      <Step
        icon={<MessageSquare className={ICON} aria-hidden />}
        title={t("settings.botConceptCollabReturnTitle")}
        note={t("settings.botConceptCollabReturnNote")}
      />
      <div className="my-2 h-px bg-separator-border" />
      <Step
        icon={<Users className={ICON} aria-hidden />}
        title={t("settings.botConceptCollabGroup")}
        note={t("settings.botConceptCollabGroupNote")}
      />
    </div>
  );
}

interface ConceptBot {
  avatar?: BotAvatar | null;
  name: string;
}

/** 四个分区的概念图。`runtime` 用当前编辑的智能体形象当流程起点。 */
export function BotConceptDiagram({
  tab,
  avatar,
  name,
}: ConceptBot & { tab: PlannedTabId }) {
  switch (tab) {
    case "runtime":
      return <RuntimeConcept avatar={avatar} name={name} />;
    case "routines":
      return <RoutinesConcept />;
    case "collab":
      return <CollabConcept />;
  }
}
