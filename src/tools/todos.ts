import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { logEvent } from "../storage/run-store.js";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
  createdAt: string;
  updatedAt: string;
};

const TodoStatusSchema = z.enum(["pending", "in_progress", "completed", "cancelled"]);

function nextTodoId(existing: TodoItem[]): string {
  const nums = existing
    .map((t) => /^todo_(\d+)$/u.exec(t.id)?.[1])
    .filter((n): n is string => Boolean(n))
    .map((n) => Number.parseInt(n, 10));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `todo_${String(next).padStart(3, "0")}`;
}

async function loadTodos(path: string): Promise<TodoItem[]> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is TodoItem =>
        typeof t === "object" && t !== null && typeof (t as TodoItem).id === "string"
    );
  } catch {
    return [];
  }
}

async function saveTodos(path: string, items: TodoItem[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(items, null, 2) + "\n");
}

function formatTodoList(items: TodoItem[]): string {
  if (items.length === 0) return "No todos.";
  const icon: Record<TodoStatus, string> = {
    pending: "[ ]",
    in_progress: "[~]",
    completed: "[x]",
    cancelled: "[-]"
  };
  return items
    .map((t) => `${icon[t.status]} ${t.id}: ${t.content} (${t.status})`)
    .join("\n");
}

export function createTodoTool(runPath: string) {
  const todosPath = join(runPath, "todos.json");

  return tool({
    description:
      "Manage structured task todos for the current session. " +
      "Actions: create (add items), edit (change content), mark (set status), remove (delete one), rewrite (replace entire list), list (show all). " +
      "Statuses: pending, in_progress, completed, cancelled.",
    inputSchema: z.object({
      action: z.enum(["create", "edit", "mark", "remove", "rewrite", "list"]),
      id: z.string().optional().describe("Todo id for edit, mark, or remove."),
      content: z.string().optional().describe("Todo text for create, edit, or rewrite items."),
      status: TodoStatusSchema.optional().describe("Status for mark action or rewrite items."),
      items: z
        .array(
          z.object({
            id: z.string().optional(),
            content: z.string(),
            status: TodoStatusSchema.optional()
          })
        )
        .optional()
        .describe("Items for create or rewrite.")
    }),
    execute: async ({ action, id, content, status, items }) => {
      const now = new Date().toISOString();
      let todos = await loadTodos(todosPath);

      switch (action) {
        case "list":
          return formatTodoList(todos);

        case "create": {
          const toAdd = items ?? (content ? [{ content, status: status ?? "pending" as const }] : []);
          if (toAdd.length === 0) return "create requires content or items.";
          for (const item of toAdd) {
            const todoId = item.id ?? nextTodoId(todos);
            todos.push({
              id: todoId,
              content: item.content,
              status: item.status ?? "pending",
              createdAt: now,
              updatedAt: now
            });
          }
          await saveTodos(todosPath, todos);
          await logEvent(runPath, "todo.created", { count: toAdd.length });
          return `Created ${toAdd.length} todo(s).\n\n${formatTodoList(todos)}`;
        }

        case "edit": {
          if (!id || !content) return "edit requires id and content.";
          const idx = todos.findIndex((t) => t.id === id);
          if (idx === -1) return `Todo "${id}" not found.`;
          todos[idx] = { ...todos[idx], content, updatedAt: now };
          await saveTodos(todosPath, todos);
          await logEvent(runPath, "todo.edited", { id });
          return `Updated ${id}.\n\n${formatTodoList(todos)}`;
        }

        case "mark": {
          if (!id || !status) return "mark requires id and status.";
          const idx = todos.findIndex((t) => t.id === id);
          if (idx === -1) return `Todo "${id}" not found.`;
          todos[idx] = { ...todos[idx], status, updatedAt: now };
          await saveTodos(todosPath, todos);
          await logEvent(runPath, "todo.marked", { id, status });
          return `Marked ${id} as ${status}.\n\n${formatTodoList(todos)}`;
        }

        case "remove": {
          if (!id) return "remove requires id.";
          const before = todos.length;
          todos = todos.filter((t) => t.id !== id);
          if (todos.length === before) return `Todo "${id}" not found.`;
          await saveTodos(todosPath, todos);
          await logEvent(runPath, "todo.removed", { id });
          return `Removed ${id}.\n\n${formatTodoList(todos)}`;
        }

        case "rewrite": {
          if (!items || items.length === 0) return "rewrite requires a non-empty items array.";
          todos = items.map((item, i) => ({
            id: item.id ?? `todo_${String(i + 1).padStart(3, "0")}`,
            content: item.content,
            status: item.status ?? "pending",
            createdAt: now,
            updatedAt: now
          }));
          await saveTodos(todosPath, todos);
          await logEvent(runPath, "todo.rewritten", { count: todos.length });
          return `Rewrote todo list (${todos.length} items).\n\n${formatTodoList(todos)}`;
        }

        default:
          return `Unknown action: ${action}`;
      }
    }
  });
}
