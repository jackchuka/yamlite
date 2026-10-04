import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { ApiError, api } from "./api";
import { staticSnapshot } from "./mode";
import { EventStore } from "./events";
import { invalidationsFor } from "./invalidate";
import { type ReflectAction, type ReflectMap, recordFileOf, reflectKey, reflectReducer } from "./reflect";

const EventsContext = createContext<EventStore | null>(null);
const ReflectContext = createContext<{ state: ReflectMap; dispatch: (a: ReflectAction) => void } | null>(null);

// a 503 that survived request()'s retries means the database is still busy
const notifyBusy = (error: unknown) => {
  if (error instanceof ApiError && error.status === 503) {
    toast.error("データベースが使用中です。少し待ってから再試行してください", { id: "db-busy" });
  }
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: notifyBusy }),
  mutationCache: new MutationCache({ onError: notifyBusy }),
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false } },
});

export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: api.meta });

export function useEventStore(): EventStore {
  const store = useContext(EventsContext);
  if (!store) throw new Error("useEventStore outside <Providers>");
  return store;
}

export function useEvents() {
  const store = useEventStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useReflect(table: string, key: string) {
  const ctx = useContext(ReflectContext);
  return ctx?.state[reflectKey(table, key)];
}

export function useReflectDispatch(): (a: ReflectAction) => void {
  const ctx = useContext(ReflectContext);
  if (!ctx) throw new Error("useReflectDispatch outside <Providers>");
  return ctx.dispatch;
}

function Wiring({ store, children }: { store: EventStore; children: ReactNode }) {
  const client = useQueryClient();
  const { data: meta } = useMeta();
  const fileOf = useMemo(() => recordFileOf(meta), [meta]);
  const [state, dispatch] = useReducer(
    (s: ReflectMap, a: ReflectAction) => reflectReducer(s, a, fileOf),
    {} as ReflectMap,
  );

  useEffect(() => {
    const off = store.listen((e) => {
      for (const queryKey of invalidationsFor(e)) void client.invalidateQueries({ queryKey });
      if (e.type !== "hello") dispatch({ type: "event", event: e });
    });
    const snapshot = staticSnapshot();
    // a snapshot has no server to stream from; its warnings are part of the export
    if (snapshot) store.hello({ activity: [], warnings: snapshot.warnings, configError: null });
    else store.connect();
    return () => {
      off();
      store.close();
    };
  }, [store, client]);

  useEffect(() => {
    const timer = setInterval(() => dispatch({ type: "tick", now: Date.now() }), 1000);
    return () => clearInterval(timer);
  }, []);

  // a failed write-back is easy to miss in a closed drawer, so it is also a toast
  const toasted = useRef(new Map<string, string>());
  useEffect(() => {
    for (const [k, r] of Object.entries(state)) {
      if (r.state !== "failed") {
        toasted.current.delete(k);
      } else if (toasted.current.get(k) !== r.reason) {
        toasted.current.set(k, r.reason);
        toast.error(`反映されませんでした: ${k.replace("\u0000", "/")}`, { id: k, description: r.reason });
      }
    }
  }, [state]);

  const reflect = useMemo(() => ({ state, dispatch }), [state]);
  return <ReflectContext.Provider value={reflect}>{children}</ReflectContext.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const store = useMemo(() => new EventStore(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <EventsContext.Provider value={store}>
        <Wiring store={store}>{children}</Wiring>
      </EventsContext.Provider>
    </QueryClientProvider>
  );
}
