import { memo } from "react";
import { useTranslation } from "react-i18next";
import Circle from "lucide-react/dist/esm/icons/circle";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2";
import type { TodoItem } from "../types";

interface TodoListProps {
  todos: TodoItem[];
}

const STATUS_ICON = {
  pending: Circle,
  in_progress: Loader2,
  completed: CheckCircle2,
} as const;

const STATUS_ICON_CLASS = {
  pending: "text-(--text-faint)",
  in_progress: "text-(--text-muted) [&_svg]:animate-[sp-spin_1s_linear_infinite]",
  completed: "text-[#89d185]",
} as const;

const STATUS_TEXT_CLASS = {
  pending: "",
  in_progress: "",
  completed: "line-through text-(--text-faint)",
} as const;

export const TodoList = memo(function TodoList({ todos }: TodoListProps) {
  const { t } = useTranslation();
  if (todos.length === 0) {
    return (
      <div className="sp-empty p-4 text-center text-(--text-faint) text-xs">
        {t("statusPanel.emptyTodos")}
      </div>
    );
  }
  return (
    <div className="sp-todo-list flex flex-col gap-0.5">
      {todos.map((todo, index) => {
        const Icon = STATUS_ICON[todo.status] ?? Circle;
        return (
          <div
            key={`${todo.content}-${index}`}
            className={`sp-todo-item sp-todo-${todo.status} flex items-start gap-2 px-2 py-1.5 rounded-lg transition-colors hover:bg-(--surface-hover)`}
          >
            <span
              className={`sp-todo-icon shrink-0 flex items-center mt-px ${STATUS_ICON_CLASS[todo.status]}`}
            >
              <Icon size={14} />
            </span>
            <span
              className={`sp-todo-text text-xs leading-snug text-(--text-strong) break-words ${STATUS_TEXT_CLASS[todo.status]}`}
            >
              {todo.content}
            </span>
          </div>
        );
      })}
    </div>
  );
});
