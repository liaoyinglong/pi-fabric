/**
 * Guest-side dependency scheduler adapted from shuding/better-all (MIT):
 * https://github.com/shuding/better-all
 *
 * Phase 1 intentionally keeps only the task-map + `this.$` dependency model.
 * It omits better-all's allSettled(), flow(), debug waterfall, and AbortSignal
 * support so the guest helper stays small and portable across QuickJS and Node.
 *
 * The helper is appended after author code inside __piFabricMain(). `all` is a
 * function declaration, so it is hoisted and callable by earlier author code.
 * Keeping generated source after author code preserves Fabric's source-map and
 * type-error line mapping: user code still starts on wrapped line 2.
 */
const BETTER_ALL_GUEST_SOURCE = String.raw`
type FabricAllTaskMap = Record<string, unknown>;
type FabricAllResolved<T> = T extends (...args: any[]) => infer R
  ? Awaited<R>
  : Awaited<T>;
type FabricAllDependencyProxy<T extends FabricAllTaskMap> = {
  readonly [K in keyof T]: Promise<FabricAllResolved<T[K]>>;
};
type FabricAllTaskContext<T extends FabricAllTaskMap> = {
  readonly $: FabricAllDependencyProxy<T>;
};
type FabricAllResult<T extends FabricAllTaskMap> = {
  [K in keyof T]: FabricAllResolved<T[K]>;
};
async function all<T extends FabricAllTaskMap>(
  tasks: T & ThisType<FabricAllTaskContext<T>>,
): Promise<FabricAllResult<T>> {
  const taskNames = Object.keys(tasks) as Array<keyof T>;
  const promises = new Map<keyof T, Promise<unknown>>();
  const resolveTask = (name: keyof T): Promise<unknown> => {
    const existing = promises.get(name);
    if (existing) return existing;
    if (!(name in tasks)) {
      return Promise.reject(new Error("Unknown task \"" + String(name) + "\""));
    }
    const task = tasks[name];
    const dependencyProxy = new Proxy({} as FabricAllDependencyProxy<T>, {
      get(_target, dependency: string | symbol) {
        if (typeof dependency === "symbol") return undefined;
        return resolveTask(dependency as keyof T);
      },
    });
    const promise = typeof task === "function"
      ? Promise.resolve().then(() =>
          (task as (...args: any[]) => any).call(
            { $: dependencyProxy } as FabricAllTaskContext<T>,
          )
        )
      : Promise.resolve(task);
    promises.set(name, promise);
    return promise;
  };
  const result: Partial<FabricAllResult<T>> = {};
  await Promise.all(
    taskNames.map(async (name) => {
      (result as Record<keyof T, unknown>)[name] = await resolveTask(name);
    }),
  );
  return result as FabricAllResult<T>;
}`;

export const withBetterAllGuestEpilogue = (code: string): string =>
  `${code}\n${BETTER_ALL_GUEST_SOURCE}`;
