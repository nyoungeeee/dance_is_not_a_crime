export const MESSAGE_KEY = 'dance-slogan-preview-messages-v1';
export function validateMessage(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error('메시지를 입력해주세요.');
  if (Array.from(text).length > 500) throw new Error('메시지는 500자 이내로 입력해주세요.');
  return text;
}
export class PreviewMessages {
  constructor(storage) {
    this.storage = storage;
    this.messages = [];
    try {
      const saved = JSON.parse(storage.getItem(MESSAGE_KEY) || '[]');
      if (Array.isArray(saved)) this.messages = saved.filter(m => m && ['user','operator'].includes(m.sender) && typeof m.id === 'string' && typeof m.text === 'string' && m.text.trim() && Array.from(m.text).length <= 500 && Number.isFinite(Date.parse(m.createdAt))).map(m => ({id:m.id,sender:m.sender,text:m.text,createdAt:m.createdAt,read:m.read===true}));
    } catch {}
  }
  save() {try {this.storage.setItem(MESSAGE_KEY,JSON.stringify(this.messages));return true;} catch {return false;}}
  send(sender,text,now=new Date()) {
    if (!['user','operator'].includes(sender)) throw new Error('메시지 발신자를 확인해주세요.');
    const message={id:crypto.randomUUID(),sender,text:validateMessage(text),createdAt:new Date(now).toISOString(),read:false};
    this.messages.push(message);
    return {message,persisted:this.save()};
  }
  markRead(viewer) {
    if (!['user','operator'].includes(viewer)) return;
    let changed=false;
    this.messages.forEach(m=>{if(m.sender!==viewer&&!m.read){m.read=true;changed=true;}});
    if(changed)this.save();
  }
  unread(viewer) {return this.messages.filter(m=>m.sender!==viewer&&!m.read).length;}
  clear() {this.storage.removeItem(MESSAGE_KEY);this.messages=[];}
}
