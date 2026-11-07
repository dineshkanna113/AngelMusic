import { useCallback, useEffect, useState } from "react";
import { api, auth } from "./api";
import { useSession } from "./hooks";

export const billingApi = {
  status: () => api("/api/billing"),
  checkout: (interval) => api("/api/billing/checkout", { method: "POST", body: { interval } }),
  portal: () => api("/api/billing/portal", { method: "POST" }),
  promos: () => api("/api/promos").then((d) => d.promos),
  allPromos: () => api("/api/promos/all").then((d) => d.promos),
  createPromo: (body) => api("/api/promos", { method: "POST", body }),
  editPromo: (id, patch) => api(`/api/promos/${id}`, { method: "PATCH", body: patch }),
  deletePromo: (id) => api(`/api/promos/${id}`, { method: "DELETE" }),
  comp: (userId, until) => api(`/api/users/${userId}/premium`, { method: "PUT", body: { until } }),
};

/** Re-read the signed-in user so `premium` is current (after paying, or when a grant changes). */
export const refreshUser = () => api("/api/auth/me").then((u) => auth.updateUser(u)).catch(() => {});

/** The billing status, loaded once per sign-in. `reload()` fetches it again. */
export function useBilling() {
  const session = useSession();
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const reload = useCallback(
    () => billingApi.status()
      .then((data) => { setState({ loading: false, data, error: "" }); return data; })
      .catch((e) => { setState({ loading: false, data: null, error: e.message }); return null; }),
    [],
  );
  useEffect(() => { if (session) reload(); }, [session?.user?.id, reload]);
  return { ...state, reload };
}
