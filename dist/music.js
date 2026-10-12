import {jumpSkeletons, clearSkeletons} from './skeletons.js?v=22';
const tracks = [
  {file:'uptown-jam.mp3', bpm:116, offset:0.041, title:'Uptown Jam', artist:'Nick Petrov', duration:138.24},
  {file:'bumpin.mp3', bpm:114, offset:0.262, title:'Bumpin', artist:'Aves', duration:165.433469},
  {file:'shake-it.mp3', bpm:127, offset:0.18, title:'Shake It', artist:'Ziskoe', duration:244.662857},
  {file:'waiting-for-sunshine.mp3', bpm:122, offset:0.491, title:'Waiting for Sunshine', artist:'Yarin Primak', duration:156.604082},
  {file:'rhythm-rocket.mp3', bpm:120, offset:0.46, title:'Rhythm Rocket', artist:'Steven Beddall', duration:133.642449}
];
const audio = document.querySelector('#music-audio');
const toggle = document.querySelector('#music-toggle');
const trackTitle = document.querySelector('#music-title');
const toggleIcon = document.querySelector('#music-toggle-icon');
const next = document.querySelector('#music-next');
const prev = document.querySelector('#music-prev');
const artist = document.querySelector('#music-artist');
const time = document.querySelector('#music-time');
const status = document.querySelector('#music-status');
const ticker = document.querySelector('.ticker');
const letters = [...ticker.querySelectorAll('.ticker-char')];
const titleStar = document.querySelector('.title-star');
let starTimer, awaitingGesture = true;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let index = 0, frame, jumpTimer, activeLetter, previousLetter, lastTick = -1, request = 0;
audio.volume = .5;
audio.src = '/assets/music/' + tracks[0].file;
function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
function updateTime() {
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : tracks[index].duration;
  time.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
}
updateTime();
function clearStar() {
  clearTimeout(starTimer);
  titleStar?.classList.remove('title-star-jump');
}
function jumpStar(bpm) {
  clearStar();
  if (!titleStar) return;
  const duration = Math.min(380, Math.max(220, 60000 / bpm * .6));
  titleStar.style.setProperty('--star-duration', `${duration}ms`);
  titleStar.classList.add('title-star-jump');
  starTimer = setTimeout(clearStar, duration);
}
function clearJump() {
  clearTimeout(jumpTimer);
  activeLetter?.classList.remove('is-jumping');
  activeLetter = null;
}
function stopBeats() {
  cancelAnimationFrame(frame);
  frame = null;
  clearJump();
  clearSkeletons();
  clearStar();
  lastTick = -1;
}
function jump() {
  clearJump();
  const bounds = ticker.getBoundingClientRect();
  if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;
  const visible = letters.filter(letter => {
    const rect = letter.getBoundingClientRect();
    return rect.left >= Math.max(0, bounds.left) && rect.right <= Math.min(window.innerWidth, bounds.right);
  });
  const candidates = visible.filter(letter => letter !== previousLetter);
  if (!candidates.length) return;
  activeLetter = candidates[Math.floor(Math.random() * candidates.length)];
  previousLetter = activeLetter;
  const duration = Math.min(380, Math.max(220, 60000 / tracks[index].bpm * .6));
  activeLetter.style.setProperty('--jump-duration', `${duration}ms`);
  activeLetter.classList.add('is-jumping');
  jumpTimer = setTimeout(clearJump, duration);
}
function tick() {
  if (audio.paused || audio.ended) {stopBeats();return;}
  const track = tracks[index];
  const beatIndex = Math.floor((audio.currentTime - track.offset) * track.bpm / 60);
  // Fixed BPM grid follows playback time; no volume detection, accumulated timer drift or catch-up bursts.
  if (beatIndex !== lastTick) {
    lastTick = beatIndex;
    if (beatIndex >= 0 && !reducedMotion.matches && !document.hidden && audio.readyState >= 3) {jump();jumpSkeletons(track.bpm);jumpStar(track.bpm);}
  }
  frame = requestAnimationFrame(tick);
}
async function play({automatic = false} = {}) {
  const current = ++request;
  status.textContent = '';
  try {
    await audio.play();
    awaitingGesture = false;
    if (current === request && !frame) tick();
  } catch (error) {
    if (current !== request) return;
    if (automatic && error.name === 'NotAllowedError') {
      awaitingGesture = true;
      status.textContent = '화면을 터치하면 음악이 시작돼요.';
      render();
      return;
    }
    awaitingGesture = false;
    status.textContent = '음악을 재생하지 못했어요. 재생 버튼을 다시 눌러주세요.';
    render();
  }
}
function render() {
  const playing = !audio.paused && !audio.ended && !audio.error;
  toggleIcon.setAttribute('d', playing ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M7 5l12 7-12 7z');
  toggle.setAttribute('aria-label', playing ? '음악 일시정지' : '음악 재생');
  toggle.setAttribute('aria-pressed', String(playing));
}
function chooseTrack(value, continuePlaying) {
  ++request;
  audio.pause();
  stopBeats();
  index = (value + tracks.length) % tracks.length;
  trackTitle.textContent = tracks[index].title;
  audio.src = '/assets/music/' + tracks[index].file;
  status.textContent = `${tracks[index].title} · ${tracks[index].artist}`;
  artist.textContent = tracks[index].artist;
  time.textContent = `0:00 / ${formatTime(tracks[index].duration)}`;
  render();
  if (continuePlaying) void play();
}
toggle.addEventListener('click', () => {
  awaitingGesture = false;
  if (audio.paused) void play();
  else {++request;audio.pause();}
});
prev.addEventListener('click', () => chooseTrack(index - 1, !audio.paused));
next.addEventListener('click', () => chooseTrack(index + 1, !audio.paused));
audio.addEventListener('play', () => {awaitingGesture = false;render();if (!frame) tick();});
audio.addEventListener('pause', () => {render();stopBeats();});
audio.addEventListener('ended', () => chooseTrack(index + 1, true));
audio.addEventListener('error', () => {stopBeats();render();status.textContent = '음악을 불러오지 못했어요. 다음 곡을 선택하거나 다시 재생해주세요.';});
audio.addEventListener('seeking', stopBeats);
audio.addEventListener('seeked', () => {if (!audio.paused && !frame) tick();});
document.addEventListener('visibilitychange', () => {clearJump();clearSkeletons();clearStar();});
reducedMotion.addEventListener('change', () => {clearJump();clearSkeletons();clearStar();});

audio.addEventListener('timeupdate', updateTime);
audio.addEventListener('loadedmetadata', updateTime);
audio.addEventListener('durationchange', updateTime);

function startAfterGesture(event) {
  if (!awaitingGesture || event.target?.closest?.('.music-player')) return;
  if (event.type === 'keydown' && !['Enter',' '].includes(event.key)) return;
  awaitingGesture = false;
  void play({automatic:true});
}
document.addEventListener('click', startAfterGesture);
document.addEventListener('keydown', startAfterGesture);
void play({automatic:true});
