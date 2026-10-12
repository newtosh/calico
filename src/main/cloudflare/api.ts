export const API_URL = "https://api.cloudflare.com/client/v4";

/** `status` is 0 when Cloudflare could not be reached. The message never holds the token. */
export class CloudflareError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Account {
  id: string;
  name: string;
}

export interface WorkerUpload {
  /** The Worker module, uploaded as index.js. */
  source: string;
  /** Plain variables. */
  vars: Record<string, string>;
  /** Secret variables. Cloudflare never shows them again. */
  secrets: Record<string, string>;
  durableObject: { binding: string; className: string };
}

interface Envelope {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: unknown;
}

/** The few Cloudflare calls that setting up the relay needs. */
export class CloudflareApi {
  constructor(
    private readonly token: string,
    private readonly base: string = API_URL,
  ) {}

  private async call(
    method: string,
    path: string,
    body?: FormData | string,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    let reply: Response;
    try {
      reply = await fetch(this.base + path, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, ...headers },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
    } catch (err) {
      throw new CloudflareError(
        0,
        `Could not reach Cloudflare: ${(err as Error).message}.`,
      );
    }
    const envelope = ((await reply.json().catch(() => null)) ?? {}) as Envelope;
    if (!reply.ok || envelope.success === false) {
      const said = (envelope.errors ?? [])
        .map((e) => e.message)
        .filter(Boolean)
        .join("; ");
      throw new CloudflareError(
        reply.status,
        `Cloudflare answered HTTP ${reply.status}${said ? `: ${said}` : ""}.`,
      );
    }
    return envelope.result;
  }

  async accounts(): Promise<Account[]> {
    const result = await this.call("GET", "/accounts");
    return (Array.isArray(result) ? result : []).flatMap((row: unknown) => {
      const item = row as { id?: unknown; name?: unknown };
      return typeof item.id === "string"
        ? [
            {
              id: item.id,
              name: typeof item.name === "string" ? item.name : item.id,
            },
          ]
        : [];
    });
  }

  /** The account's workers.dev name, or null when it never picked one. */
  async subdomain(accountId: string): Promise<string | null> {
    try {
      const result = (await this.call(
        "GET",
        `/accounts/${accountId}/workers/subdomain`,
      )) as {
        subdomain?: unknown;
      } | null;
      return typeof result?.subdomain === "string" && result.subdomain
        ? result.subdomain
        : null;
    } catch (err) {
      if (err instanceof CloudflareError && err.status === 404) return null;
      throw err;
    }
  }

  async scriptExists(accountId: string, name: string): Promise<boolean> {
    const result = await this.call(
      "GET",
      `/accounts/${accountId}/workers/scripts`,
    );
    return (Array.isArray(result) ? result : []).some(
      (row: unknown) => (row as { id?: unknown }).id === name,
    );
  }

  async uploadWorker(
    accountId: string,
    name: string,
    upload: WorkerUpload,
  ): Promise<void> {
    const metadata = {
      main_module: "index.js",
      compatibility_date: "2026-09-01",
      bindings: [
        {
          type: "durable_object_namespace",
          name: upload.durableObject.binding,
          class_name: upload.durableObject.className,
        },
        ...Object.entries(upload.vars).map(([key, text]) => ({
          type: "plain_text",
          name: key,
          text,
        })),
        ...Object.entries(upload.secrets).map(([key, text]) => ({
          type: "secret_text",
          name: key,
          text,
        })),
      ],
      migrations: {
        new_tag: "v1",
        new_sqlite_classes: [upload.durableObject.className],
      },
    };
    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    );
    form.append(
      "index.js",
      new Blob([upload.source], { type: "application/javascript+module" }),
      "index.js",
    );
    await this.call(
      "PUT",
      `/accounts/${accountId}/workers/scripts/${name}`,
      form,
    );
  }

  async enableSubdomain(accountId: string, name: string): Promise<void> {
    await this.call(
      "POST",
      `/accounts/${accountId}/workers/scripts/${name}/subdomain`,
      JSON.stringify({ enabled: true, previews_enabled: false }),
      { "content-type": "application/json" },
    );
  }

  async deleteWorker(accountId: string, name: string): Promise<void> {
    try {
      await this.call(
        "DELETE",
        `/accounts/${accountId}/workers/scripts/${name}?force=true`,
      );
    } catch (err) {
      // Already gone is what we wanted.
      if (!(err instanceof CloudflareError && err.status === 404)) throw err;
    }
  }
}
