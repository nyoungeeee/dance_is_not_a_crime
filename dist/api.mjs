// 서버 API 호출. 쓰기 요청에는 CSRF 차단용 헤더를 붙인다(server/src/main.ts).
export class ApiError extends Error {
  constructor(status, code, message) {super(message);this.status = status;this.code = code;}
}
export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {method, credentials:'same-origin', signal:AbortSignal.timeout(15000), headers:{'x-dance':'1', ...(body === undefined ? {} : {'content-type':'application/json'})}, body:body === undefined ? undefined : JSON.stringify(body)});
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new ApiError(0, 'TIMEOUT', '응답이 늦어요. 잠시 후 다시 시도해주세요.');
    throw new ApiError(0, 'NETWORK', '인터넷 연결을 확인하고 다시 시도해주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code || 'ERROR', data.message || '잠시 후 다시 시도해주세요.');
  return data;
}
