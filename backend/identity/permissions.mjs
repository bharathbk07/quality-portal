export const roles = ["admin", "viewer", "developer", "tester"];
export function capabilities(role) {
  return {
    canWrite: ["admin", "developer", "tester"].includes(role),
    canManage: role === "admin",
    canUseAgents: ["admin", "developer"].includes(role),
  };
}
