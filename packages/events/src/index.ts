export type EventPayload = {
  "issue:created": {
    issue: { id: string; floorId: string; title: string };
    floorId: string;
  };
  "issue:stage_changed": { issueId: string; from: string; to: string };
  "issue:assigned": { issueId: string; agentId: string };
  "issue:intake": {
    floorId: string;
    agentId: string;
    issue: {
      id: string;
      number: number;
      title: string;
      body: string | null;
      html_url: string | null;
    };
  };
  "notice:created": { noticeId: string; floorId: string; title: string };
};

type EventName = keyof EventPayload;
type Handler<E extends EventName> = (payload: EventPayload[E]) => void;

export class EventBus {
  private handlers = new Map<EventName, Set<Handler<EventName>>>();

  subscribe<E extends EventName>(event: E, handler: Handler<E>): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<EventName>);
  }

  unsubscribe<E extends EventName>(event: E, handler: Handler<E>): void {
    this.handlers.get(event)?.delete(handler as Handler<EventName>);
  }

  publish<E extends EventName>(event: E, payload: EventPayload[E]): void {
    this.handlers.get(event)?.forEach((h) => (h as Handler<E>)(payload));
  }
}

export const bus = new EventBus();
export type { EventName, Handler };
