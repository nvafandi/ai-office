export type ProviderId =
  | "confluence"
  | "notion"
  | "google-docs"
  | "google-slides"
  | "google-drive"
  | "google-sheets"
  | "google-calendar"
  | "slack";

export const PROVIDERS: ProviderId[] = [
  "confluence",
  "notion",
  "google-docs",
  "google-slides",
  "google-drive",
  "google-sheets",
  "google-calendar",
  "slack",
];

export interface Connection {
  id: string;
  provider: ProviderId;
  label: string;
  mock: true;
}

export interface SendResult {
  ok: true;
  provider: string;
  messageId: string;
  mock: true;
}

export class ConnectionManager {
  private connections = new Map<string, Connection>();

  constructor() {
    for (const provider of PROVIDERS) {
      const id = `conn_${provider}`;
      this.connections.set(id, {
        id,
        provider,
        label:
          provider.charAt(0).toUpperCase() + provider.slice(1).replace("-", " "),
        mock: true,
      });
    }
  }

  listConnections(): Connection[] {
    return Array.from(this.connections.values());
  }

  getConnection(id: string): Connection | undefined {
    return this.connections.get(id);
  }

  sendNotification(id: string, message: string): SendResult {
    const c = this.getConnection(id);
    if (!c) throw new Error(`connection not found: ${id}`);
    return {
      ok: true,
      provider: c.provider,
      messageId: `msg_${crypto.randomUUID().replace(/-/g, "")}`,
      mock: true,
    };
  }
}

export const connectionManager = new ConnectionManager();
