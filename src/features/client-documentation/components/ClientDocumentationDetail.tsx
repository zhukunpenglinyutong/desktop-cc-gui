import type { ClientDocumentationNode } from "../clientDocumentationTypes";
import type { ClientDocumentationIconComponent } from "./clientDocumentationIcons";
import { getClientDocumentationIconComponent } from "./clientDocumentationIcons";

type ClientDocumentationDetailProps = {
  node: ClientDocumentationNode | null;
  missingNodeId?: string | null;
  onResetSelection: () => void;
};

const DETAIL_PROSE_CLASSES =
  "[&_p]:text-(--text-primary) [&_p]:leading-[1.7] [&_li]:text-(--text-primary) [&_li]:leading-[1.7] [&_ul]:m-0 [&_ul]:pl-5 [&_ol]:m-0 [&_ol]:pl-5";

const SECTION_CLASSES =
  "client-documentation-section my-[22px] py-[18px] px-5 border border-(--border-subtle) rounded-[18px] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),transparent),color-mix(in_srgb,var(--surface-raised)_86%,transparent)] shadow-[0_14px_40px_rgba(15,23,42,0.07)]";

const SECTION_H2_CLASSES = "[&>h2]:m-0 [&>h2]:mb-2.5 [&>h2]:text-[15px] [&>h2]:text-(--text-stronger)";

function renderList(items: string[]) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function ClientDocumentationDetail({
  node,
  missingNodeId = null,
  onResetSelection,
}: ClientDocumentationDetailProps) {
  if (!node) {
    return (
      <section
        className={`client-documentation-detail is-empty max-w-[980px] mx-auto min-h-[60vh] flex flex-col items-start justify-center ${DETAIL_PROSE_CLASSES}`}
      >
        <p className="client-documentation-eyebrow text-[#2563eb] text-xs tracking-[0.12em] uppercase font-[750]">
          Recoverable state
        </p>
        <h1 className="mt-2 mb-3 text-[clamp(32px,5vw,58px)] leading-[1.05] text-(--text-stronger) tracking-[-0.06em]">
          暂无可展示的说明文档
        </h1>
        <p>文档数据为空或当前节点不可用。请返回默认模块后继续阅读。</p>
        {missingNodeId ? (
          <p className="client-documentation-missing-node [&_code]:text-[#2563eb]">
            未找到节点：<code>{missingNodeId}</code>
          </p>
        ) : null}
        <button type="button" className="primary" onClick={onResetSelection}>
          返回默认模块
        </button>
      </section>
    );
  }

  const Icon: ClientDocumentationIconComponent = getClientDocumentationIconComponent(
    node.iconKey,
  );
  const usageSteps = node.usageSteps ?? node.workflow ?? [];

  return (
    <article
      className={`client-documentation-detail max-w-[980px] mx-auto ${DETAIL_PROSE_CLASSES}`}
    >
      <header className="client-documentation-hero grid grid-cols-[auto_minmax(0,1fr)] gap-[18px] items-center mb-[26px] max-[820px]:grid-cols-[1fr]">
        <div
          className="client-documentation-hero-icon w-18 h-18 rounded-3xl inline-flex items-center justify-center text-white bg-[linear-gradient(135deg,#2563eb,#0ea5e9),#2563eb] shadow-[0_18px_40px_rgba(37,99,235,0.26),inset_0_1px_0_rgba(255,255,255,0.28)] max-[820px]:w-[58px] max-[820px]:h-[58px] max-[820px]:rounded-[19px]"
          aria-hidden="true"
        >
          <Icon size={30} strokeWidth={2} />
        </div>
        <div>
          <p className="client-documentation-eyebrow text-[#2563eb] text-xs tracking-[0.12em] uppercase font-[750]">
            Client module
          </p>
          <h1 className="mt-2 mb-3 text-[clamp(32px,5vw,58px)] leading-[1.05] text-(--text-stronger) tracking-[-0.06em]">
            {node.title}
          </h1>
          <p className="client-documentation-summary text-(--text-muted) text-base leading-[1.7] m-0">
            {node.summary}
          </p>
        </div>
      </header>

      <div className="client-documentation-overview-grid grid grid-cols-2 gap-4 mb-[18px] max-[820px]:grid-cols-[1fr]">
        <section
          className={`client-documentation-overview-card m-0 py-[18px] px-5 border border-(--border-subtle) rounded-[18px] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),transparent),color-mix(in_srgb,var(--surface-raised)_86%,transparent)] shadow-[0_14px_40px_rgba(15,23,42,0.07)] ${SECTION_H2_CLASSES}`}
        >
          <h2>模块定位</h2>
          <p>{node.purpose}</p>
        </section>

        <section
          className={`client-documentation-overview-card m-0 py-[18px] px-5 border border-(--border-subtle) rounded-[18px] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),transparent),color-mix(in_srgb,var(--surface-raised)_86%,transparent)] shadow-[0_14px_40px_rgba(15,23,42,0.07)] ${SECTION_H2_CLASSES}`}
        >
          <h2>入口位置</h2>
          <p>{node.entry}</p>
        </section>
      </div>

      <section className={`${SECTION_CLASSES} ${SECTION_H2_CLASSES}`}>
        <h2>核心功能点</h2>
        <div className="client-documentation-feature-grid flex flex-wrap gap-[9px]">
          {node.features.map((featureName) => (
            <span
              className="client-documentation-feature-chip border border-[rgba(37,99,235,0.18)] rounded-[14px] py-2 px-[11px] text-(--text-stronger) bg-[rgba(37,99,235,0.08)] text-[13px] font-[650]"
              key={featureName}
            >
              {featureName}
            </span>
          ))}
        </div>
      </section>

      {usageSteps.length > 0 ? (
        <section
          className={`${SECTION_CLASSES} is-usage relative overflow-hidden ${SECTION_H2_CLASSES} before:content-[''] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[linear-gradient(180deg,#2563eb,rgba(14,165,233,0.15))]`}
        >
          <div className="client-documentation-section-heading flex items-baseline justify-between gap-[14px] mb-[14px] [&>h2]:m-0">
            <h2>模块使用说明</h2>
            <span className="text-(--text-subtle) text-[11px] font-extrabold tracking-[0.12em] uppercase">
              {usageSteps.length} steps
            </span>
          </div>
          <ol className="client-documentation-usage-steps flex flex-col gap-3 list-none !pl-0">
            {usageSteps.map((step, index) => (
              <li
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 items-start"
                key={step}
              >
                <span className="client-documentation-step-index w-[34px] h-7 rounded-full inline-flex items-center justify-center text-[#2563eb] bg-[rgba(37,99,235,0.12)] text-[11px] font-[850] tracking-[-0.03em]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {node.workflow && node.workflow.length > 0 ? (
        <section className={`${SECTION_CLASSES} ${SECTION_H2_CLASSES}`}>
          <h2>典型使用流程</h2>
          <ol>
            {node.workflow.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className={`${SECTION_CLASSES} ${SECTION_H2_CLASSES}`}>
        <h2>注意事项</h2>
        {renderList(node.notes)}
      </section>

      <section className={`${SECTION_CLASSES} ${SECTION_H2_CLASSES}`}>
        <h2>关联模块</h2>
        <div className="client-documentation-related-modules flex flex-wrap gap-2">
          {node.relatedModules.map((moduleName) => (
            <span
              className="client-documentation-related-module rounded-full py-[5px] px-2.5 bg-[rgba(37,99,235,0.14)] text-(--text-stronger) text-xs"
              key={moduleName}
            >
              {moduleName}
            </span>
          ))}
        </div>
      </section>
    </article>
  );
}
