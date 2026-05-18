"use client";

import type { ItemInstance, TreeInstance } from "@headless-tree/core";
import { ChevronDownIcon } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

interface TreeContextValue<T = any> {
  indent: number;
  currentItem?: ItemInstance<T>;
  tree?: TreeInstance<T>;
}

const TreeContext = React.createContext<TreeContextValue>({
  currentItem: undefined,
  indent: 20,
  tree: undefined,
});

function useTreeContext<T>() {
  return React.useContext(TreeContext) as TreeContextValue<T>;
}

interface TreeProps<T> extends React.HTMLAttributes<HTMLDivElement> {
  indent?: number;
  tree?: TreeInstance<T>;
  treeLabel?: string;
}

function Tree<T>({
  indent = 20,
  tree,
  treeLabel,
  className,
  ...props
}: TreeProps<T>) {
  const containerProps = tree?.getContainerProps(treeLabel) ?? {};
  const { style: containerStyle, ...otherContainerProps } = containerProps;
  const { style: propStyle, ...otherProps } = props;

  const mergedStyle = {
    ...containerStyle,
    ...propStyle,
    "--tree-indent": `${indent}px`,
  } as React.CSSProperties;

  return (
    <TreeContext.Provider value={{ indent, tree }}>
      <div
        className={cn("flex flex-col", className)}
        data-slot="tree"
        style={mergedStyle}
        {...otherContainerProps}
        {...otherProps}
      />
    </TreeContext.Provider>
  );
}

interface TreeItemProps<T> extends React.HTMLAttributes<HTMLButtonElement> {
  item: ItemInstance<T>;
  asChild?: boolean;
}

function TreeItem<T>({
  item,
  className,
  asChild,
  children,
  ...props
}: TreeItemProps<T>) {
  const { indent } = useTreeContext<T>();
  const itemProps = item.getProps() as React.HTMLAttributes<HTMLButtonElement>;
  const { style: itemStyle, ...otherItemProps } = itemProps;
  const { style: propStyle, ...otherProps } = props;

  const mergedStyle = {
    ...itemStyle,
    ...propStyle,
    "--tree-padding": `${item.getItemMeta().level * indent}px`,
  } as React.CSSProperties;

  const Comp = asChild ? Slot.Root : "button";

  return (
    <TreeContext.Provider value={{ currentItem: item, indent }}>
      <Comp
        aria-expanded={item.isExpanded()}
        className={cn(
          "z-10 select-none ps-(--tree-padding) not-last:pb-0.5 outline-hidden focus:z-20 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          className,
        )}
        data-drag-target={
          typeof item.isDragTarget === "function"
            ? item.isDragTarget() || false
            : undefined
        }
        data-focus={
          typeof item.isFocused === "function" ? item.isFocused() || false : undefined
        }
        data-folder={
          typeof item.isFolder === "function" ? item.isFolder() || false : undefined
        }
        data-search-match={
          typeof item.isMatchingSearch === "function"
            ? item.isMatchingSearch() || false
            : undefined
        }
        data-selected={
          typeof item.isSelected === "function" ? item.isSelected() || false : undefined
        }
        data-slot="tree-item"
        style={mergedStyle}
        {...otherItemProps}
        {...otherProps}
      >
        {children}
      </Comp>
    </TreeContext.Provider>
  );
}

interface TreeItemLabelProps<T> extends React.HTMLAttributes<HTMLSpanElement> {
  item?: ItemInstance<T>;
  showChevron?: boolean;
}

function TreeItemLabel<T>({
  item: propItem,
  showChevron = true,
  children,
  className,
  ...props
}: TreeItemLabelProps<T>) {
  const { currentItem } = useTreeContext<T>();
  const item = propItem || currentItem;

  if (!item) {
    return null;
  }

  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-sm bg-background in-data-[drag-target=true]:bg-accent in-data-[search-match=true]:bg-blue-400/20! in-data-[selected=true]:bg-accent px-2 py-1.5 not-in-data-[folder=true]:ps-7 in-data-[selected=true]:text-accent-foreground text-sm in-focus-visible:ring-[3px] in-focus-visible:ring-ring/50 transition-colors hover:bg-accent [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      data-slot="tree-item-label"
      {...props}
    >
      {showChevron && item.isFolder() ? (
        <ChevronDownIcon
          aria-hidden
          className="in-aria-[expanded=false]:-rotate-90 size-4 text-muted-foreground"
          data-tree-toggle
        />
      ) : null}
      {children ||
        (typeof item.getItemName === "function" ? item.getItemName() : null)}
    </span>
  );
}

function TreeDragLine({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { tree } = useTreeContext<unknown>();

  if (!tree || typeof tree.getDragLineStyle !== "function") {
    return null;
  }

  const dragLine = tree.getDragLineStyle();
  return (
    <div
      className={cn(
        "-mt-px before:-top-[3px] absolute z-30 h-0.5 w-[unset] bg-primary before:absolute before:left-0 before:size-2 before:rounded-full before:border-2 before:border-primary before:bg-background",
        className,
      )}
      style={dragLine}
      {...props}
    />
  );
}

export { Tree, TreeDragLine, TreeItem, TreeItemLabel };
