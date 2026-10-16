import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

export type AppTicket = { ticket: string; receivedAt: number };

export type AppTicketStore = {
  get(): Promise<AppTicket | null>;
  save(ticket: AppTicket): Promise<void>;
};

function normalize(value: unknown): AppTicket {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("app_ticket 持久化数据无效");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => key !== "ticket" && key !== "receivedAt")) {
    throw new Error("app_ticket 持久化数据包含未知属性");
  }
  if (typeof item.ticket !== "string" || !item.ticket.trim()) throw new Error("app_ticket 为空");
  if (!Number.isFinite(item.receivedAt)) throw new Error("app_ticket 接收时间无效");
  return { ticket: item.ticket.trim(), receivedAt: Number(item.receivedAt) };
}

export function createJsonFileAppTicketStore(options: { path: string }): AppTicketStore {
  if (!isAbsolute(options.path)) throw new Error("app_ticket 持久化路径必须是绝对路径");
  let cached: AppTicket | null | undefined;
  let writeQueue = Promise.resolve();
  const load = async () => {
    if (cached !== undefined) return cached;
    try {
      cached = normalize(JSON.parse(await readFile(options.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") cached = null;
      else if (error instanceof SyntaxError) throw new Error("app_ticket 持久化文件已损坏");
      else throw error;
    }
    return cached;
  };
  return {
    get: load,
    async save(value) {
      const ticket = normalize(value);
      writeQueue = writeQueue.then(async () => {
        await mkdir(dirname(options.path), { recursive: true });
        const temporary = `${options.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(ticket)}\n`, { encoding: "utf8", flag: "wx" });
        try { await rename(temporary, options.path); } finally { await rm(temporary, { force: true }); }
        cached = ticket;
      });
      await writeQueue;
    },
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export function createAppTicketEventHandler(options: {
  appId: string;
  verificationToken: string;
  store: AppTicketStore;
  now?: () => number;
}): (request: Request) => Promise<Response> {
  const appId = options.appId.trim();
  const verificationToken = options.verificationToken.trim();
  if (!appId || !verificationToken) throw new Error("app_ticket 事件配置不完整");
  const now = options.now ?? Date.now;
  return async (request) => {
    if (request.method !== "POST") return Response.json({ code: "METHOD_NOT_ALLOWED" }, { status: 405 });
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return Response.json({ code: "CONTENT_TYPE_INVALID" }, { status: 415 });
    }
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch {
      return Response.json({ code: "JSON_INVALID" }, { status: 400 });
    }
    if (typeof body.encrypt === "string") {
      return Response.json({ code: "ENCRYPTED_EVENT_NOT_CONFIGURED" }, { status: 400 });
    }
    if (typeof body.token !== "string" || !safeEqual(body.token, verificationToken)) {
      return Response.json({ code: "VERIFICATION_FAILED" }, { status: 401 });
    }
    if (body.type === "url_verification" && typeof body.challenge === "string") {
      return Response.json({ challenge: body.challenge });
    }
    const event = body.event;
    if (!event || typeof event !== "object" || Array.isArray(event)) return Response.json({ code: 0 });
    const item = event as Record<string, unknown>;
    if (item.type !== "app_ticket") return Response.json({ code: 0 });
    if (item.app_id !== appId || typeof item.app_ticket !== "string" || !item.app_ticket.trim()) {
      return Response.json({ code: "APP_TICKET_INVALID" }, { status: 400 });
    }
    await options.store.save({ ticket: item.app_ticket.trim(), receivedAt: now() });
    return Response.json({ code: 0 });
  };
}
