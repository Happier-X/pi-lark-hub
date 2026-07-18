import type { FeishuCredentials } from "./credentials.js";
const PATH = "/oauth/v1/app/registration";
type Fetch = typeof fetch;
type Json = Record<string, unknown>;
async function post(fetchFn: Fetch, base: string, body: Json): Promise<Json> {
 const r = await fetchFn(`${base}${PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
 const j = await r.json() as Json;
 if (!r.ok) throw new Error(`飞书注册服务返回 HTTP ${r.status}`);
 return j;
}
function err(j: Json): string | undefined {
 const nestedError = j.error && typeof j.error === "object" ? j.error as Json : undefined;
 const nestedData = j.data && typeof j.data === "object" ? j.data as Json : undefined;
 const dataError = nestedData?.error && typeof nestedData.error === "object" ? nestedData.error as Json : undefined;
 const candidates = [j.error, j.error_description, j.msg, j.message, nestedError?.code, nestedError?.message, nestedError?.msg, nestedData?.error_description, nestedData?.msg, nestedData?.message, dataError?.code, dataError?.message, dataError?.msg];
 const value = candidates.find((item): item is string => typeof item === "string" && Boolean(item.trim()));
 return value?.replace(/(client|app)?[_ -]?secret[^,\s]*/gi, "密钥").slice(0, 120);
}
function requiredString(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`飞书注册响应缺少 ${field}`); return value.trim(); }
export type RegistrationChallenge = { deviceCode: string; url: string; intervalMs: number; expiresAt: number; brand: "feishu" | "lark" };
export type RegistrationResult = { credentials: FeishuCredentials; ownerOpenId?: string };
export class FeishuRegistrationClient {
 constructor(private fetchFn: Fetch = fetch) {}
 async begin(now = Date.now()): Promise<RegistrationChallenge> {
  const base = "https://accounts.feishu.cn";
  const init = await post(this.fetchFn, base, { action: "init", supported_auth_methods: ["client_secret"] });
  if (err(init)) throw new Error(`初始化扫码失败：${err(init)}`);
  const initData = (init.data && typeof init.data === "object" ? init.data : {}) as Json;
  const methods = init.supported_auth_methods ?? initData.supported_auth_methods;
  if (!Array.isArray(methods) || !methods.includes("client_secret")) throw new Error("飞书注册服务未确认支持 client_secret");
  const j = await post(this.fetchFn, base, { action: "begin", archetype: "PersonalAgent", auth_method: "client_secret", request_user_info: "open_id" });
  if (err(j)) throw new Error(`发起扫码失败：${err(j)}`);
  const d = (j.data && typeof j.data === "object" ? j.data : j) as Json;
  const deviceCode = requiredString(d.device_code, "device_code");
  const url = requiredString(d.verification_uri_complete, "verification_uri_complete");
  try { if (!/^https:\/\//i.test(url)) throw new Error(); new URL(url); } catch { throw new Error("飞书注册响应二维码 URL 无效"); }
  const expire = Number(d.expire_in); if (!Number.isFinite(expire) || expire <= 0) throw new Error("飞书注册响应缺少有效 expire_in");
  return { deviceCode, url, intervalMs: Math.max(1000, Number(d.interval || 5) * 1000), expiresAt: now + expire * 1000, brand: d.tenant_brand === "lark" ? "lark" : "feishu" };
 }
 async poll(c: RegistrationChallenge, signal?: AbortSignal): Promise<RegistrationResult> {
  let delay = c.intervalMs;
  let base = c.brand === "lark" ? "https://accounts.larksuite.com" : "https://accounts.feishu.cn";
  while (Date.now() < c.expiresAt) {
   await new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, delay); signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("扫码开局已取消")); }, { once: true }); });
   const j = await post(this.fetchFn, base, { action: "poll", device_code: c.deviceCode });
   const e = err(j);
   if (e === "authorization_pending" || e === "pending") continue;
   if (e === "slow_down") { delay += 5000; continue; }
   if (e === "expired_token") throw new Error("二维码已过期");
   if (e === "access_denied") throw new Error("用户拒绝了飞书授权");
   if (e) throw new Error(`飞书扫码失败：${e}`);
   const d = (j.data && typeof j.data === "object" ? j.data : j) as Json;
   if (d.tenant_brand === "lark") base = "https://accounts.larksuite.com";
   if (typeof d.client_id === "string" && typeof d.client_secret === "string" && d.client_id.trim() && d.client_secret.trim()) {
    const userInfo = (d.user_info && typeof d.user_info === "object" ? d.user_info : {}) as Json;
    return { credentials: { appId: d.client_id.trim(), appSecret: d.client_secret.trim(), brand: d.tenant_brand === "lark" ? "lark" : c.brand, updatedAt: Date.now() }, ownerOpenId: typeof userInfo.open_id === "string" && userInfo.open_id.trim() ? userInfo.open_id.trim() : undefined };
   }
   throw new Error("飞书注册成功响应缺少 client_id/client_secret");
  }
  throw new Error("飞书扫码开局超时");
 }
}
