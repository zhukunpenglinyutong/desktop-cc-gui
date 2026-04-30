import {
  noteCardArchive,
  noteCardCreate,
  noteCardDelete,
  noteCardGet,
  noteCardList,
  noteCardRestore,
  noteCardUpdate,
  type WorkspaceNoteCard,
  type WorkspaceNoteCardListResult,
} from "../../../services/tauri";

export type ListWorkspaceNoteCardsParams = {
  workspaceId: string;
  workspaceName?: string | null;
  workspacePath?: string | null;
  archived: boolean;
  query?: string | null;
  page?: number | null;
  pageSize?: number | null;
};

export type CreateWorkspaceNoteCardParams = {
  workspaceId: string;
  workspaceName?: string | null;
  workspacePath?: string | null;
  title?: string | null;
  bodyMarkdown: string;
  attachmentInputs?: string[] | null;
};

export type UpdateWorkspaceNoteCardParams = {
  workspaceName?: string | null;
  workspacePath?: string | null;
  title?: string | null;
  bodyMarkdown?: string | null;
  attachmentInputs?: string[] | null;
};

export const noteCardsFacade = {
  list(params: ListWorkspaceNoteCardsParams): Promise<WorkspaceNoteCardListResult> {
    return noteCardList(params);
  },
  get(params: {
    noteId: string;
    workspaceId: string;
    workspaceName?: string | null;
    workspacePath?: string | null;
  }): Promise<WorkspaceNoteCard | null> {
    return noteCardGet(params);
  },
  create(params: CreateWorkspaceNoteCardParams): Promise<WorkspaceNoteCard> {
    return noteCardCreate(params);
  },
  update(
    noteId: string,
    workspaceId: string,
    patch: UpdateWorkspaceNoteCardParams,
  ): Promise<WorkspaceNoteCard> {
    return noteCardUpdate(noteId, workspaceId, patch);
  },
  archive(params: {
    noteId: string;
    workspaceId: string;
    workspaceName?: string | null;
    workspacePath?: string | null;
  }): Promise<WorkspaceNoteCard> {
    return noteCardArchive(params);
  },
  restore(params: {
    noteId: string;
    workspaceId: string;
    workspaceName?: string | null;
    workspacePath?: string | null;
  }): Promise<WorkspaceNoteCard> {
    return noteCardRestore(params);
  },
  delete(params: {
    noteId: string;
    workspaceId: string;
    workspaceName?: string | null;
    workspacePath?: string | null;
  }): Promise<void> {
    return noteCardDelete(params);
  },
};
