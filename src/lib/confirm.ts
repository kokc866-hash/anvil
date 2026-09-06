export type ConfirmAsk = {
  body: string;
  title?: string;
  ok?: string;
  cancel?: string;
  danger?: boolean;
  secondary?: string;
};

type Slot = ConfirmAsk & { resolve: (ok: boolean | "secondary") => void };

let slot: Slot | null = null;
const subs = new Set<(s: Slot | null) => void>();

function emit() {
  for (const fn of subs) fn(slot);
}

export function subscribeConfirm(fn: (s: Slot | null) => void): () => void {
  subs.add(fn);
  fn(slot);
  return () => subs.delete(fn);
}

function askApp(body: string, opts?: Omit<ConfirmAsk, "body">): Promise<boolean | "secondary"> {
  return new Promise((resolve) => {
    if (slot) slot.resolve(false);
    slot = { body, ...opts, resolve: (ok) => {
      slot = null;
      emit();
      resolve(ok);
    } };
    emit();
  });
}

export function confirmApp(body: string, opts?: Omit<ConfirmAsk, "body">): Promise<boolean> {
  return askApp(body, opts).then((answer) => answer === true);
}
export function saveChoice(body: string): Promise<"save" | "discard" | "cancel"> {
  return askApp(body, { title: "Ungespeicherte Änderungen", ok: "Speichern", secondary: "Verwerfen", cancel: "Abbrechen" })
    .then((answer) => answer === true ? "save" : answer === "secondary" ? "discard" : "cancel");
}
