export function validateMessage(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error('메시지를 입력해주세요.');
  if (Array.from(text).length > 500) throw new Error('메시지는 500자 이내로 입력해주세요.');
  return text;
}
