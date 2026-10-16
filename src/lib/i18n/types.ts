// The shape every language must have. The French dictionary is declared as `Messages`, so the
// compiler refuses it if a message is missing, extra, or takes different arguments than the
// English one. (String values are widened, so French may of course say something else.)

import type { en } from "./en";

type Widen<T> = T extends string
  ? string
  : T extends readonly string[]
    ? readonly string[]
    : T extends (...args: infer A) => string[]
      ? (...args: A) => string[]
      : T extends (...args: infer A) => string
        ? (...args: A) => string
        : T extends object
          ? { [K in keyof T]: Widen<T[K]> }
          : T;

export type Messages = Widen<typeof en>;
