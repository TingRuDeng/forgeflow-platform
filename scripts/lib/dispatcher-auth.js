export function getDispatcherAuthHeader() {
    const token = process.env.DISPATCHER_API_TOKEN;
    if (!token) {
        return {};
    }
    return { Authorization: `Bearer ${token}` };
}
export function isDispatcherAuthEnabled() {
    return !!process.env.DISPATCHER_API_TOKEN;
}
