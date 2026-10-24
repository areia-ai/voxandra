"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  ContactRound,
  ExternalLink,
  GripVertical,
  Loader2,
  PencilLine,
  Trash2,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Contact, Reminder, ReminderStatus } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { mapDocs } from "@/lib/convex-helpers";
import { useToast } from "@/components/ui/toast";
import { AddReminderModal } from "./add-reminder-modal";

const ORDER_STEP = 1000;
const REMINDER_ID_PREFIX = "reminder:";
const COLUMN_ID_PREFIX = "column:";
const columnIds = ["due", "in_progress", "completed"] as const;

type ColumnId = (typeof columnIds)[number];
type TargetReminderStatus = Exclude<ReminderStatus, "overdue">;
type BoardColumns = Record<ColumnId, Reminder[]>;
type ColumnDefinition = {
  id: ColumnId;
  label: string;
  shortLabel: string;
  statuses: readonly ReminderStatus[];
  targetStatus: TargetReminderStatus;
  icon: typeof AlertCircle;
  color: string;
  bg: string;
  border: string;
  active: string;
  emptyLabel: string;
};

const columns: readonly ColumnDefinition[] = [
  {
    id: "due",
    label: "Due",
    shortLabel: "Due",
    statuses: ["upcoming", "overdue"],
    targetStatus: "upcoming",
    icon: AlertCircle,
    color: "text-amber-700 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/20",
    border: "border-amber-200 dark:border-amber-900/50",
    active:
      "border-amber-300 bg-amber-100/70 shadow-[0_0_0_3px_rgba(245,158,11,0.16)] dark:border-amber-700 dark:bg-amber-900/30 dark:shadow-[0_0_0_3px_rgba(245,158,11,0.12)]",
    emptyLabel: "Nothing due",
  },
  {
    id: "in_progress",
    label: "In Progress",
    shortLabel: "Active",
    statuses: ["in_progress"],
    targetStatus: "in_progress",
    icon: Clock,
    color: "text-blue-700 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/20",
    border: "border-blue-200 dark:border-blue-900/50",
    active:
      "border-blue-300 bg-blue-100/70 shadow-[0_0_0_3px_rgba(59,130,246,0.14)] dark:border-blue-700 dark:bg-blue-900/30 dark:shadow-[0_0_0_3px_rgba(59,130,246,0.12)]",
    emptyLabel: "No active follow-ups",
  },
  {
    id: "completed",
    label: "Completed",
    shortLabel: "Done",
    statuses: ["completed"],
    targetStatus: "completed",
    icon: CheckCircle2,
    color: "text-green-700 dark:text-green-400",
    bg: "bg-green-50 dark:bg-green-950/20",
    border: "border-green-200 dark:border-green-900/50",
    active:
      "border-green-300 bg-green-100/70 shadow-[0_0_0_3px_rgba(34,197,94,0.14)] dark:border-green-700 dark:bg-green-900/30 dark:shadow-[0_0_0_3px_rgba(34,197,94,0.12)]",
    emptyLabel: "Nothing completed yet",
  },
];

function reminderDndId(reminderId: string) {
  return `${REMINDER_ID_PREFIX}${reminderId}`;
}

function columnDndId(columnId: ColumnId) {
  return `${COLUMN_ID_PREFIX}${columnId}`;
}

function reminderIdFromDndId(id: UniqueIdentifier) {
  const value = String(id);
  return value.startsWith(REMINDER_ID_PREFIX)
    ? value.slice(REMINDER_ID_PREFIX.length)
    : null;
}

function isColumnId(value: string): value is ColumnId {
  return (columnIds as readonly string[]).includes(value);
}

function columnIdFromDndId(id: UniqueIdentifier) {
  const value = String(id);
  const columnId = value.startsWith(COLUMN_ID_PREFIX)
    ? value.slice(COLUMN_ID_PREFIX.length)
    : value;
  return isColumnId(columnId) ? columnId : null;
}

function statusForColumn(columnId: ColumnId): TargetReminderStatus {
  if (columnId === "due") return "upcoming";
  return columnId;
}

function persistedStatusForReminder(columnId: ColumnId, reminder: Reminder): ReminderStatus {
  if (columnId === "due" && reminder.status === "overdue") return "overdue";
  return statusForColumn(columnId);
}

function columnFromStatus(status: ReminderStatus): ColumnId {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "in_progress";
  return "due";
}

function reminderSortTime(reminder: Reminder) {
  const time = Date.parse(reminder.remindAt);
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function compareReminders(a: Reminder, b: Reminder) {
  const aOrder = typeof a.kanbanOrder === "number" ? a.kanbanOrder : null;
  const bOrder = typeof b.kanbanOrder === "number" ? b.kanbanOrder : null;

  if (aOrder !== null && bOrder !== null && aOrder !== bOrder) {
    return aOrder - bOrder;
  }
  if (aOrder !== null && bOrder === null) return -1;
  if (aOrder === null && bOrder !== null) return 1;

  const timeDiff = reminderSortTime(a) - reminderSortTime(b);
  if (timeDiff !== 0) return timeDiff;
  return a.title.localeCompare(b.title);
}

function groupReminders(reminders: Reminder[]): BoardColumns {
  const board: BoardColumns = {
    due: [],
    in_progress: [],
    completed: [],
  };

  for (const reminder of reminders) {
    board[columnFromStatus(reminder.status)].push(reminder);
  }

  for (const columnId of columnIds) {
    board[columnId].sort(compareReminders);
  }

  return board;
}

function findReminder(board: BoardColumns, reminderId: string) {
  for (const columnId of columnIds) {
    const reminder = board[columnId].find((item) => item.id === reminderId);
    if (reminder) return reminder;
  }
  return null;
}

function findColumnByReminderId(board: BoardColumns, reminderId: string) {
  for (const columnId of columnIds) {
    if (board[columnId].some((item) => item.id === reminderId)) {
      return columnId;
    }
  }
  return null;
}

function getOverColumn(board: BoardColumns, overId: UniqueIdentifier) {
  const columnId = columnIdFromDndId(overId);
  if (columnId) return columnId;

  const overReminderId = reminderIdFromDndId(overId);
  return overReminderId ? findColumnByReminderId(board, overReminderId) : null;
}

function moveReminder(board: BoardColumns, reminderId: string, overId: UniqueIdentifier): BoardColumns {
  const sourceColumnId = findColumnByReminderId(board, reminderId);
  const targetColumnId = getOverColumn(board, overId);
  if (!sourceColumnId || !targetColumnId) return board;

  const sourceItems = board[sourceColumnId];
  const sourceIndex = sourceItems.findIndex((item) => item.id === reminderId);
  if (sourceIndex === -1) return board;

  const overReminderId = reminderIdFromDndId(overId);

  if (sourceColumnId === targetColumnId) {
    if (!overReminderId) return board;
    const overIndex = sourceItems.findIndex((item) => item.id === overReminderId);
    if (overIndex === -1 || overIndex === sourceIndex) return board;

    return {
      ...board,
      [sourceColumnId]: arrayMove(sourceItems, sourceIndex, overIndex),
    };
  }

  const movedReminder = {
    ...sourceItems[sourceIndex],
    status: statusForColumn(targetColumnId),
  };
  const nextSourceItems = sourceItems.filter((item) => item.id !== reminderId);
  const targetItems = board[targetColumnId];
  const insertIndex = overReminderId
    ? targetItems.findIndex((item) => item.id === overReminderId)
    : targetItems.length;
  const nextTargetItems = [...targetItems];
  nextTargetItems.splice(insertIndex === -1 ? targetItems.length : insertIndex, 0, movedReminder);

  return {
    ...board,
    [sourceColumnId]: nextSourceItems,
    [targetColumnId]: nextTargetItems,
  };
}

function moveReminderToStatus(
  board: BoardColumns,
  reminderId: string,
  status: TargetReminderStatus
): BoardColumns {
  const sourceColumnId = findColumnByReminderId(board, reminderId);
  if (!sourceColumnId) return board;

  const targetColumnId = columnFromStatus(status);
  const sourceItems = board[sourceColumnId];
  const reminder = sourceItems.find((item) => item.id === reminderId);
  if (!reminder) return board;

  const movedReminder = { ...reminder, status };
  if (sourceColumnId === targetColumnId) {
    return {
      ...board,
      [sourceColumnId]: sourceItems.map((item) =>
        item.id === reminderId ? movedReminder : item
      ),
    };
  }

  return {
    ...board,
    [sourceColumnId]: sourceItems.filter((item) => item.id !== reminderId),
    [targetColumnId]: [...board[targetColumnId], movedReminder],
  };
}

function changedColumns(before: BoardColumns, after: BoardColumns) {
  return columnIds.filter((columnId) => {
    const beforeIds = before[columnId].map((item) => item.id);
    const afterIds = after[columnId].map((item) => item.id);

    if (beforeIds.length !== afterIds.length) return true;
    return beforeIds.some((id, index) => id !== afterIds[index]);
  });
}

function buildKanbanUpdates(board: BoardColumns, changedColumnIds: readonly ColumnId[]) {
  return changedColumnIds.flatMap((columnId) => {
    return board[columnId].map((reminder, index) => ({
      reminderId: reminder.id as Id<"reminders">,
      status: persistedStatusForReminder(columnId, reminder),
      kanbanOrder: (index + 1) * ORDER_STEP,
    }));
  });
}

function removeReminderFromBoard(board: BoardColumns, reminderId: string): BoardColumns {
  const columnId = findColumnByReminderId(board, reminderId);
  if (!columnId) return board;

  return {
    ...board,
    [columnId]: board[columnId].filter((item) => item.id !== reminderId),
  };
}

function clearCompletedFromBoard(board: BoardColumns): BoardColumns {
  if (board.completed.length === 0) return board;
  return { ...board, completed: [] };
}

function reminderSourceHref(reminder: Reminder) {
  if (reminder.callId) return `/app/calls/${reminder.callId}#reminders`;
  if (reminder.caseId) return `/app/threads/${reminder.caseId}`;
  return null;
}

function sourceLabel(reminder: Reminder) {
  if (reminder.callId) return "Call record";
  if (reminder.caseId) return "Thread";
  if (reminder.contactId) return "Contact-linked";
  return "Workspace";
}

function addOneDayLocalIso(iso: string) {
  const date = new Date(iso);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function DragPreviewCard({ reminder }: { reminder: Reminder }) {
  return (
    <div className="w-[min(320px,calc(100vw-2rem))] rotate-1 rounded-lg border border-violet-300 bg-white p-4 shadow-2xl dark:border-violet-700 dark:bg-stone-900">
      <div className="flex items-start gap-3">
        <GripVertical className="mt-0.5 h-4 w-4 text-violet-400 dark:text-violet-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-900 dark:text-stone-50">{reminder.title}</p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{formatDateTime(reminder.remindAt)}</p>
        </div>
      </div>
    </div>
  );
}

function KanbanCard({
  reminder,
  contact,
  isActive,
  isSaving,
  isDeleting,
  onStatusChange,
  onDeleteCompleted,
  onSnooze,
  onEdit,
}: {
  reminder: Reminder;
  contact?: Contact;
  isActive: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onStatusChange: (id: string, status: TargetReminderStatus) => void;
  onDeleteCompleted: (id: string) => void;
  onSnooze: (reminder: Reminder) => void;
  onEdit: (reminder: Reminder) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: reminderDndId(reminder.id),
    data: { type: "reminder", reminderId: reminder.id },
    disabled: isSaving,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const currentColumnId = columnFromStatus(reminder.status);
  const sourceHref = reminderSourceHref(reminder);
  const busy = isSaving || isDeleting;
  const isOverdue = reminder.status === "overdue";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "group relative rounded-lg border bg-white p-4 shadow-sm outline-none dark:bg-stone-900",
        "transition-[background-color,border-color,box-shadow,opacity,transform] duration-200 ease-out",
        isOverdue
          ? "border-l-4 border-l-rose-500 border-y-stone-200 border-r-stone-200 dark:border-y-stone-800 dark:border-r-stone-800"
          : "border-stone-200 dark:border-stone-800",
        isDragging
          ? "scale-[0.98] border-violet-200 opacity-40 shadow-none dark:border-violet-800"
          : "hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md dark:hover:border-stone-700",
        isActive ? "ring-2 ring-violet-200 dark:ring-violet-900" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-label={`Drag reminder ${reminder.title}`}
          {...attributes}
          {...listeners}
          className="mt-0.5 rounded-md p-0.5 text-stone-300 transition-colors hover:bg-stone-100 hover:text-stone-500 focus:outline-none focus:ring-2 focus:ring-violet-200 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 dark:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-300 dark:focus:ring-violet-900"
          disabled={busy}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-5 text-stone-900 dark:text-stone-50">{reminder.title}</p>
          {contact ? (
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-stone-600 dark:text-stone-300">
              <ContactRound aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {contact.name}
                {contact.phoneNumber ? ` · ${contact.phoneNumber}` : ""}
              </span>
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span
              className={`inline-flex items-center gap-1 ${
                isOverdue ? "font-semibold text-rose-700 dark:text-rose-400" : "text-stone-500 dark:text-stone-400"
              }`}
            >
              <CalendarClock aria-hidden="true" className="h-3.5 w-3.5" />
              {formatDateTime(reminder.remindAt)}
              {isOverdue ? " · Overdue" : ""}
            </span>
            {sourceHref ? (
              <Link
                href={sourceHref}
                className="inline-flex items-center gap-1 font-medium text-violet-700 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-300"
              >
                {sourceLabel(reminder)}
                <ExternalLink aria-hidden="true" className="h-3 w-3" />
              </Link>
            ) : (
              <span className="text-stone-500 dark:text-stone-400">{sourceLabel(reminder)}</span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {reminder.status !== "completed" ? (
          <>
            <button
              type="button"
              onClick={() => onSnooze(reminder)}
              disabled={busy}
              className="rounded-md border border-transparent bg-stone-50 px-2 py-1 text-[11px] font-medium text-stone-500 transition-colors hover:border-stone-200 hover:bg-white hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-800/60 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              Snooze 1 day
            </button>
            <button
              type="button"
              onClick={() => onEdit(reminder)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-transparent bg-stone-50 px-2 py-1 text-[11px] font-medium text-stone-500 transition-colors hover:border-stone-200 hover:bg-white hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-800/60 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              <PencilLine aria-hidden="true" className="h-3 w-3" />
              Edit
            </button>
          </>
        ) : null}
        {columns.map((column) =>
          column.id === currentColumnId ? null : (
            <button
              key={column.id}
              type="button"
              onClick={() => onStatusChange(reminder.id, column.targetStatus)}
              disabled={busy}
              className="rounded-md border border-transparent bg-stone-50 px-2 py-1 text-[11px] font-medium text-stone-500 transition-colors hover:border-stone-200 hover:bg-white hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-800/60 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              Move to {column.shortLabel}
            </button>
          )
        )}
        {reminder.status === "completed" ? (
          <button
            type="button"
            onClick={() => onDeleteCompleted(reminder.id)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-transparent bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 transition-colors hover:border-red-100 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-950/40 dark:text-red-300 dark:hover:border-red-900 dark:hover:bg-red-950/60"
          >
            {isDeleting ? (
              <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="h-3 w-3" />
            )}
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

function KanbanColumn({
  column,
  items,
  contactsById,
  activeReminderId,
  overColumnId,
  isSaving,
  deletingReminderId,
  onStatusChange,
  onDeleteCompleted,
  onAddReminder,
  onSnooze,
  onEdit,
}: {
  column: ColumnDefinition;
  items: Reminder[];
  contactsById: Map<string, Contact>;
  activeReminderId: string | null;
  overColumnId: ColumnId | null;
  isSaving: boolean;
  deletingReminderId: string | null;
  onStatusChange: (id: string, status: TargetReminderStatus) => void;
  onDeleteCompleted: (id: string) => void;
  onAddReminder?: () => void;
  onSnooze: (reminder: Reminder) => void;
  onEdit: (reminder: Reminder) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: columnDndId(column.id),
    data: { type: "column", columnId: column.id },
  });
  const isDropTarget = isOver || overColumnId === column.id;
  const Icon = column.icon;

  return (
    <div
      ref={setNodeRef}
      className={[
        "flex min-h-[22rem] flex-col rounded-xl border p-4 transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out xl:max-h-[calc(100vh-18rem)]",
        column.border,
        column.bg,
        isDropTarget ? column.active : "",
      ].join(" ")}
    >
      <div className="mb-4 flex items-center gap-2">
        <Icon className={`h-5 w-5 ${column.color}`} />
        <h3 className="font-semibold text-stone-900 dark:text-stone-100">{column.label}</h3>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-900 dark:text-stone-300">
          {items.length}
        </span>
      </div>
      <SortableContext
        id={columnDndId(column.id)}
        items={items.map((item) => reminderDndId(item.id))}
        strategy={verticalListSortingStrategy}
      >
        <div className="min-h-[112px] flex-1 space-y-3 overflow-y-auto pr-1">
          {items.map((reminder) => (
            <KanbanCard
              key={reminder.id}
              reminder={reminder}
              contact={reminder.contactId ? contactsById.get(reminder.contactId) : undefined}
              isActive={activeReminderId === reminder.id}
              isSaving={isSaving}
              isDeleting={deletingReminderId === reminder.id}
              onStatusChange={onStatusChange}
              onDeleteCompleted={onDeleteCompleted}
              onSnooze={onSnooze}
              onEdit={onEdit}
            />
          ))}
          {items.length === 0 && (
            <div
              className={[
                "flex min-h-24 flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-white/60 px-4 py-8 text-center text-sm transition-colors dark:bg-stone-900/40",
                isDropTarget
                  ? "border-violet-300 text-violet-500 dark:border-violet-700 dark:text-violet-300"
                  : "border-stone-300/80 text-stone-400 dark:border-stone-700 dark:text-stone-500",
              ].join(" ")}
            >
              {activeReminderId ? "Drop reminder here" : column.emptyLabel}
              {!activeReminderId && onAddReminder ? (
                <button
                  type="button"
                  onClick={onAddReminder}
                  className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  Add reminder
                </button>
              ) : null}
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export function ReminderKanban({
  reminders,
  onAddReminder,
}: {
  reminders: Reminder[];
  onAddReminder?: () => void;
}) {
  const updateKanbanOrder = useMutation(api.reminders.updateKanbanOrder);
  const updateReminder = useMutation(api.reminders.updateReminder);
  const deleteCompletedReminder = useMutation(api.reminders.deleteCompletedReminder);
  const deleteCompletedReminders = useMutation(api.reminders.deleteCompletedReminders);
  const contactsRaw = useQuery(api.contacts.getContacts);
  const { showToast } = useToast();
  const serverBoard = useMemo(() => groupReminders(reminders), [reminders]);
  const contactsById = useMemo(() => {
    return new Map(contactsRaw ? mapDocs(contactsRaw).map((contact) => [contact.id, contact]) : []);
  }, [contactsRaw]);
  const [localBoard, setLocalBoard] = useState<BoardColumns | null>(null);
  const [activeReminderId, setActiveReminderId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<ColumnId | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingReminderId, setDeletingReminderId] = useState<string | null>(null);
  const [isClearingCompleted, setIsClearingCompleted] = useState(false);
  const [confirmClearCompleted, setConfirmClearCompleted] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardNotice, setBoardNotice] = useState<string | null>(null);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const board = localBoard ?? serverBoard;
  const [mobileColumn, setMobileColumn] = useState<ColumnId>("due");
  const boardRef = useRef(board);
  const serverBoardRef = useRef(serverBoard);
  const dragStartBoardRef = useRef<BoardColumns | null>(null);
  const movedDuringDragRef = useRef(false);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    serverBoardRef.current = serverBoard;
  }, [serverBoard]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const activeReminder = activeReminderId ? findReminder(board, activeReminderId) : null;
  const openCount = board.due.length + board.in_progress.length;
  const totalCount = openCount + board.completed.length;
  const overdueCount = board.due.filter((reminder) => reminder.status === "overdue").length;
  const boardBusy = isSaving || isClearingCompleted || deletingReminderId !== null;

  async function persistBoard(nextBoard: BoardColumns, changedColumnIds: readonly ColumnId[]) {
    const updates = buildKanbanUpdates(nextBoard, changedColumnIds);
    if (updates.length === 0) return;

    setIsSaving(true);
    setBoardError(null);

    try {
      await updateKanbanOrder({ updates });
      setLocalBoard(null);
      setBoardNotice(null);
    } catch {
      boardRef.current = serverBoardRef.current;
      setLocalBoard(null);
      setBoardError("Could not save the reminder board. Your last move was rolled back.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: TargetReminderStatus) {
    if (boardBusy) return;
    const previousBoard = boardRef.current;
    const nextBoard = moveReminderToStatus(previousBoard, id, status);
    const changedColumnIds = changedColumns(previousBoard, nextBoard);
    if (changedColumnIds.length === 0) return;

    boardRef.current = nextBoard;
    setLocalBoard(nextBoard);
    await persistBoard(nextBoard, changedColumnIds);
  }

  function handleDragStart(event: DragStartEvent) {
    if (boardBusy) return;
    const reminderId = reminderIdFromDndId(event.active.id);
    if (!reminderId) return;

    dragStartBoardRef.current = boardRef.current;
    movedDuringDragRef.current = false;
    setBoardError(null);
    setBoardNotice(null);
    setActiveReminderId(reminderId);
    setOverColumnId(findColumnByReminderId(boardRef.current, reminderId));
  }

  function handleDragOver(event: DragOverEvent) {
    if (boardBusy) return;
    const reminderId = reminderIdFromDndId(event.active.id);
    const overId = event.over?.id;
    if (!reminderId || !overId) return;

    const targetColumnId = getOverColumn(boardRef.current, overId);
    setOverColumnId(targetColumnId);

    setLocalBoard((currentBoard) => {
      const boardBeforeMove = currentBoard ?? boardRef.current;
      const nextBoard = moveReminder(boardBeforeMove, reminderId, overId);
      if (nextBoard !== boardBeforeMove) {
        movedDuringDragRef.current = true;
        boardRef.current = nextBoard;
      }
      return nextBoard === boardBeforeMove ? currentBoard : nextBoard;
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (boardBusy) return;
    const reminderId = reminderIdFromDndId(event.active.id);
    const previousBoard = dragStartBoardRef.current;
    setOverColumnId(null);

    if (!reminderId || !event.over || !previousBoard) {
      boardRef.current = previousBoard ?? serverBoardRef.current;
      setLocalBoard(null);
      setActiveReminderId(null);
      dragStartBoardRef.current = null;
      movedDuringDragRef.current = false;
      return;
    }

    let nextBoard = boardRef.current;
    if (!movedDuringDragRef.current) {
      nextBoard = moveReminder(nextBoard, reminderId, event.over.id);
      boardRef.current = nextBoard;
      setLocalBoard(nextBoard);
    }

    const changedColumnIds = changedColumns(previousBoard, nextBoard);
    setActiveReminderId(null);
    dragStartBoardRef.current = null;
    movedDuringDragRef.current = false;

    if (changedColumnIds.length === 0) {
      setLocalBoard(null);
      return;
    }
    await persistBoard(nextBoard, changedColumnIds);
  }

  function handleDragCancel() {
    const previousBoard = dragStartBoardRef.current ?? serverBoardRef.current;
    boardRef.current = previousBoard;
    setLocalBoard(null);
    setActiveReminderId(null);
    setOverColumnId(null);
    dragStartBoardRef.current = null;
    movedDuringDragRef.current = false;
  }

  async function handleDeleteCompletedReminder(id: string) {
    if (boardBusy) return;
    const reminder = findReminder(boardRef.current, id);
    if (!reminder || reminder.status !== "completed") return;

    const previousBoard = boardRef.current;
    const nextBoard = removeReminderFromBoard(previousBoard, id);
    boardRef.current = nextBoard;
    setLocalBoard(nextBoard);
    setDeletingReminderId(id);
    setBoardError(null);
    setBoardNotice(null);

    try {
      await deleteCompletedReminder({ reminderId: id as Id<"reminders"> });
      setLocalBoard(null);
      setBoardNotice("Completed reminder deleted.");
    } catch {
      boardRef.current = serverBoardRef.current;
      setLocalBoard(null);
      setBoardError("Could not delete that completed reminder.");
    } finally {
      setDeletingReminderId(null);
    }
  }

  async function handleSnooze(reminder: Reminder) {
    if (boardBusy) return;
    setIsSaving(true);
    setBoardError(null);
    try {
      await updateReminder({
        reminderId: reminder.id as Id<"reminders">,
        remindAt: addOneDayLocalIso(reminder.remindAt),
        status: reminder.status === "overdue" ? "upcoming" : undefined,
      });
      showToast("Reminder snoozed for 1 day.", "success");
    } catch (caught) {
      setBoardError(caught instanceof Error ? caught.message : "Could not snooze that reminder.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClearCompleted() {
    if (boardBusy || board.completed.length === 0) return;
    if (!confirmClearCompleted) {
      setConfirmClearCompleted(true);
      setBoardNotice(null);
      return;
    }

    const previousBoard = boardRef.current;
    const completedCount = previousBoard.completed.length;
    const nextBoard = clearCompletedFromBoard(previousBoard);
    boardRef.current = nextBoard;
    setLocalBoard(nextBoard);
    setIsClearingCompleted(true);
    setConfirmClearCompleted(false);
    setBoardError(null);
    setBoardNotice(null);

    try {
      const result = await deleteCompletedReminders({});
      setLocalBoard(null);
      setBoardNotice(
        result.deletedCount === 1
          ? "Cleared 1 completed reminder."
          : `Cleared ${result.deletedCount || completedCount} completed reminders.`
      );
    } catch {
      boardRef.current = serverBoardRef.current;
      setLocalBoard(null);
      setBoardError("Could not clear completed reminders.");
    } finally {
      setIsClearingCompleted(false);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-4">
        <section className="rounded-xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-surface">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid min-w-[7rem] gap-1">
              <span className="text-xs font-semibold uppercase text-stone-500 dark:text-stone-400">Open</span>
              <span className="text-2xl font-semibold text-stone-950 dark:text-stone-50">{openCount}</span>
            </div>
            <div className="grid min-w-[7rem] gap-1">
              <span className="text-xs font-semibold uppercase text-stone-500 dark:text-stone-400">Overdue</span>
              <span
                className={
                  overdueCount > 0
                    ? "text-2xl font-semibold text-amber-700 dark:text-amber-400"
                    : "text-2xl font-semibold text-stone-950 dark:text-stone-50"
                }
              >
                {overdueCount}
              </span>
            </div>
            <div className="grid min-w-[7rem] gap-1">
              <span className="text-xs font-semibold uppercase text-stone-500 dark:text-stone-400">Completed</span>
              <span className="text-2xl font-semibold text-stone-950 dark:text-stone-50">{board.completed.length}</span>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                {totalCount} total
              </span>
              {board.completed.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={handleClearCompleted}
                    disabled={boardBusy}
                    className={[
                      "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
                      confirmClearCompleted
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "border border-stone-200 bg-white text-stone-700 hover:border-red-200 hover:text-red-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-red-900 dark:hover:text-red-400",
                    ].join(" ")}
                  >
                    {isClearingCompleted ? (
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    )}
                    {confirmClearCompleted ? "Confirm clear" : "Clear completed"}
                  </button>
                  {confirmClearCompleted ? (
                    <button
                      type="button"
                      onClick={() => setConfirmClearCompleted(false)}
                      className="rounded-md px-3 py-2 text-sm font-semibold text-stone-500 hover:bg-stone-50 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                    >
                      Cancel
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </section>
        {boardError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
          >
            {boardError}
          </div>
        )}
        {boardNotice && (
          <div
            role="status"
            className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300"
          >
            {boardNotice}
          </div>
        )}
        <div
          role="tablist"
          aria-label="Reminder column"
          className="grid grid-cols-3 gap-1 rounded-full bg-stone-100/70 p-1 dark:bg-stone-800/70 lg:hidden"
        >
          {columns.map((column) => {
            const active = mobileColumn === column.id;
            return (
              <button
                key={column.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMobileColumn(column.id)}
                className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-2 text-xs font-semibold transition ${
                  active
                    ? "bg-white text-brand shadow-[0_8px_20px_rgba(28,25,23,0.08)] dark:bg-stone-900 dark:text-violet-300"
                    : "text-stone-600 hover:bg-white/70 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-900/70 dark:hover:text-stone-100"
                }`}
              >
                {column.shortLabel}
                <span className="rounded-full bg-black/5 px-1.5 dark:bg-white/10">{board[column.id].length}</span>
              </button>
            );
          })}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {columns.map((column) => (
            <div
              key={column.id}
              className={mobileColumn === column.id ? "block" : "hidden lg:block"}
            >
              <KanbanColumn
                column={column}
                items={board[column.id]}
                contactsById={contactsById}
                activeReminderId={activeReminderId}
                overColumnId={overColumnId}
                isSaving={boardBusy}
                deletingReminderId={deletingReminderId}
                onStatusChange={handleStatusChange}
                onDeleteCompleted={handleDeleteCompletedReminder}
                onAddReminder={column.id === "due" ? onAddReminder : undefined}
                onSnooze={(reminder) => void handleSnooze(reminder)}
                onEdit={setEditingReminder}
              />
            </div>
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "ease-out" }}>
        {activeReminder ? <DragPreviewCard reminder={activeReminder} /> : null}
      </DragOverlay>
      <AddReminderModal
        open={Boolean(editingReminder)}
        onClose={() => setEditingReminder(null)}
        reminder={editingReminder}
      />
    </DndContext>
  );
}
