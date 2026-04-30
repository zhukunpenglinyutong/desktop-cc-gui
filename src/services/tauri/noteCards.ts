import { invoke } from "@tauri-apps/api/core";

export type NoteCardAttachment = {
  id: string;
  fileName: string;
  contentType: string;
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
};

export type NoteCardPreviewAttachment = Pick<
  NoteCardAttachment,
  "id" | "fileName" | "contentType" | "absolutePath"
>;

export type WorkspaceNoteCard = {
  id: string;
  workspaceId: string;
  workspaceName?: string | null;
  workspacePath?: string | null;
  projectName: string;
  title: string;
  bodyMarkdown: string;
  plainTextExcerpt: string;
  attachments: NoteCardAttachment[];
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
};

export type WorkspaceNoteCardSummary = {
  id: string;
  title: string;
  plainTextExcerpt: string;
  updatedAt: number;
  createdAt: number;
  archivedAt?: number | null;
  archived: boolean;
  imageCount: number;
  previewAttachments: NoteCardPreviewAttachment[];
};

export type WorkspaceNoteCardListResult = {
  items: WorkspaceNoteCardSummary[];
  total: number;
};

export async function noteCardList(params: {
  workspaceId: string;
  workspaceName?: string | null;
  workspacePath?: string | null;
  archived: boolean;
  query?: string | null;
  page?: number | null;
  pageSize?: number | null;
}): Promise<WorkspaceNoteCardListResult> {
  return invoke<WorkspaceNoteCardListResult>("note_card_list", {
    workspaceId: params.workspaceId,
    workspaceName: params.workspaceName ?? null,
    workspacePath: params.workspacePath ?? null,
    archived: params.archived,
    query: params.query ?? null,
    page: params.page ?? null,
    pageSize: params.pageSize ?? null,
  });
}

export async function noteCardGet(params: {
  noteId: string;
  workspaceId: string;
  workspaceName?: string | null;
  workspacePath?: string | null;
}): Promise<WorkspaceNoteCard | null> {
  return invoke<WorkspaceNoteCard | null>("note_card_get", {
    noteId: params.noteId,
    workspaceId: params.workspaceId,
    workspaceName: params.workspaceName ?? null,
    workspacePath: params.workspacePath ?? null,
  });
}

export async function noteCardCreate(input: {
  workspaceId: string;
  workspaceName?: string | null;
  workspacePath?: string | null;
  title?: string | null;
  bodyMarkdown: string;
  attachmentInputs?: string[] | null;
}): Promise<WorkspaceNoteCard> {
  return invoke<WorkspaceNoteCard>("note_card_create", {
    input: {
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName ?? null,
      workspacePath: input.workspacePath ?? null,
      title: input.title ?? null,
      bodyMarkdown: input.bodyMarkdown,
      attachmentInputs: input.attachmentInputs ?? null,
    },
  });
}

export async function noteCardUpdate(
  noteId: string,
  workspaceId: string,
  patch: {
    workspaceName?: string | null;
    workspacePath?: string | null;
    title?: string | null;
    bodyMarkdown?: string | null;
    attachmentInputs?: string[] | null;
  },
): Promise<WorkspaceNoteCard> {
  return invoke<WorkspaceNoteCard>("note_card_update", {
    noteId,
    workspaceId,
    patch: {
      workspaceName: patch.workspaceName ?? null,
      workspacePath: patch.workspacePath ?? null,
      title: patch.title ?? null,
      bodyMarkdown: patch.bodyMarkdown ?? null,
      attachmentInputs: patch.attachmentInputs ?? null,
    },
  });
}

export async function noteCardArchive(params: {
  noteId: string;
  workspaceId: string;
  workspaceName?: string | null;
  workspacePath?: string | null;
}): Promise<WorkspaceNoteCard> {
  return invoke<WorkspaceNoteCard>("note_card_archive", {
    noteId: params.noteId,
    workspaceId: params.workspaceId,
    workspaceName: params.workspaceName ?? null,
    workspacePath: params.workspacePath ?? null,
  });
}

export async function noteCardRestore(params: {
  noteId: string;
  workspaceId: string;
  workspaceName?: string | null;
  workspacePath?: string | null;
}): Promise<WorkspaceNoteCard> {
  return invoke<WorkspaceNoteCard>("note_card_restore", {
    noteId: params.noteId,
    workspaceId: params.workspaceId,
    workspaceName: params.workspaceName ?? null,
    workspacePath: params.workspacePath ?? null,
  });
}

export async function noteCardDelete(params: {
  noteId: string;
  workspaceId: string;
  workspaceName?: string | null;
  workspacePath?: string | null;
}): Promise<void> {
  return invoke("note_card_delete", {
    noteId: params.noteId,
    workspaceId: params.workspaceId,
    workspaceName: params.workspaceName ?? null,
    workspacePath: params.workspacePath ?? null,
  });
}
