
const data = window.APP_DATA;
const campus = data.campus;
const restaurants = data.restaurants;
const routes = data.routes || [];
const cultureTips = data.cultureTips || [];

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const escapeHtml = (v='') => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const won = v => v ? new Intl.NumberFormat('ko-KR').format(v) + '원' : '확인 필요 / Check';
const categoryEn = { '전체':'All', '음식점':'Restaurant', '카페':'Cafe' };
const typeIcon = v => v === '카페' ? '☕' : '🍽️';
const priceText = v => v===1 ? '₩ 가성비 / Budget' : v===2 ? '₩₩ 보통 / Standard' : v===3 ? '₩₩₩ 여유 / Premium' : '가격 확인 / Check price';
const spiceText = v => v<=1 ? 'Mild 순한맛' : v<=3 ? 'Medium 보통' : 'Spicy 매운맛';
const qFor = place => encodeURIComponent((place.searchQuery || `${place.nameKo || ''} ${place.address || ''}`).trim());
const googleOpen = place => `https://www.google.com/maps/search/?api=1&query=${qFor(place)}`;
const naverOpen = place => `https://map.naver.com/p/search/${qFor(place)}`;
const kakaoOpen = place => `https://map.kakao.com/link/search/${qFor(place)}`;
const youtubeOpen = place => `https://www.youtube.com/results?search_query=${encodeURIComponent(place.nameKo + ' ' + place.menus.map(m=>m.ko).join(' ') + ' 먹방 음식 소개')}`;

let state = { category:'전체', price:'all', spice:'all', sort:'recommend', q:'', favOnly:false, selectedId:null, user:null };
let favs = JSON.parse(localStorage.getItem('wkuEatsFavs') || '[]');
let reviews = JSON.parse(localStorage.getItem('wkuEatsReviews') || '{}');
const saveFavs = () => localStorage.setItem('wkuEatsFavs', JSON.stringify(favs));
const saveReviews = () => localStorage.setItem('wkuEatsReviews', JSON.stringify(reviews));

let map, markers = new Map(), userMarker = null, campusMarker = null, userCircle = null;

function haversineKm(a,b,c,d){
  const R = 6371; const toRad = x => x * Math.PI / 180;
  const dLat = toRad(c-a), dLng = toRad(d-b);
  const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
function distanceFromUser(r){ return state.user ? haversineKm(state.user.lat, state.user.lng, r.lat, r.lng) : null; }
function distanceLabel(r){
  const d = distanceFromUser(r);
  if (d == null) return '거리 계산 전 / No distance';
  if (d < 1) return `${Math.round(d*1000)}m`;
  return `${d.toFixed(1)}km`;
}
function setStatus(text, type=''){
  const el = $('#mapStatus'); if(!el) return;
  el.className = `status ${type}`.trim(); el.textContent = text;
}

function initStats(){
  $('#stat-count').textContent = restaurants.length;
  updateNearestStat();
}
function updateNearestStat(){
  const el = $('#stat-nearest');
  if (!el) return;
  if (!state.user){ el.textContent = '—'; return; }
  const nearest = [...restaurants].sort((a,b)=>distanceFromUser(a)-distanceFromUser(b))[0];
  el.textContent = nearest ? distanceLabel(nearest) : '—';
}
function initFilters(){
  const cats = ['전체', ...new Set(restaurants.map(r=>r.category))];
  $('#categorySelect').innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">${c==='전체'?'전체 장소':escapeHtml(c)} / ${escapeHtml(categoryEn[c]||c)}</option>`).join('');
  $('#chipBar').innerHTML = cats.map(c => `<button type="button" class="chip ${c===state.category?'active':''}" data-cat="${escapeHtml(c)}">${c==='전체'?'전체 All':`${typeIcon(c)} ${escapeHtml(c)} / ${escapeHtml(categoryEn[c]||'')}`}</button>`).join('');
}
function placeSearchText(r){
  return [r.nameKo,r.nameEn,r.category,r.subCategory,r.subCategoryEn,r.address,r.area,r.foodKo,r.foodEn,r.cultureKo,r.cultureEn,r.orderPhraseKo,r.orderPhraseEn,...(r.tags||[]),...(r.features||[]),...r.menus.flatMap(m=>[m.ko,m.en])].join(' ').toLowerCase();
}
function filtered(){
  let list = restaurants.filter(r => {
    if (state.category !== '전체' && r.category !== state.category) return false;
    if (state.price !== 'all' && String(r.priceLevel) !== state.price) return false;
    if (state.favOnly && !favs.includes(r.id)) return false;
    if (state.spice !== 'all') {
      const [min,max] = state.spice.split('-').map(Number);
      if (r.spice < min || r.spice > max) return false;
    }
    if (state.q && !placeSearchText(r).includes(state.q.toLowerCase())) return false;
    return true;
  });
  if (state.sort === 'distance') list.sort((a,b) => {
    if (!state.user) return (a.priority||50)-(b.priority||50);
    return distanceFromUser(a) - distanceFromUser(b);
  });
  else if (state.sort === 'price') list.sort((a,b)=>(a.menus[0]?.price||999999)-(b.menus[0]?.price||999999));
  else if (state.sort === 'rating') list.sort((a,b)=>(b.rating||0)-(a.rating||0));
  else if (state.sort === 'name') list.sort((a,b)=>a.nameKo.localeCompare(b.nameKo,'ko'));
  else list.sort((a,b)=>(b.rating||0)-(a.rating||0) || (a.priceLevel||9)-(b.priceLevel||9));
  return list;
}
function menuPreview(r){
  return r.menus.slice(0,2).map(m => `<div class="menu-item"><span>${escapeHtml(m.ko)}<small>${escapeHtml(m.en||'')}</small></span><strong>${won(m.price)}</strong></div>`).join('');
}
function placeCard(r){
  const isFav = favs.includes(r.id);
  const selected = state.selectedId === r.id ? ' selected' : '';
  return `<article class="place-card${selected}" id="card-${escapeHtml(r.id)}">
    <div class="card-top">
      <div><h3>${escapeHtml(r.nameKo)}<small>${escapeHtml(r.nameEn)}</small></h3></div>
      <span class="badge ${r.category==='카페'?'cafe-badge':'food-badge'}">${typeIcon(r.category)} ${escapeHtml(r.category)} / ${escapeHtml(categoryEn[r.category]||r.category)}</span>
    </div>
    <div class="meta"><span>${priceText(r.priceLevel)}</span><span>${spiceText(r.spice)}</span><span>📍 ${distanceLabel(r)}</span></div>
    <p class="address">${escapeHtml(r.address)}</p>
    <div class="menu-list">${menuPreview(r)}</div>
    <p class="food-text">${escapeHtml(r.foodKo)}<small>${escapeHtml(r.foodEn)}</small></p>
    <div class="card-actions">
      <button class="action-btn orange" data-map="${escapeHtml(r.id)}" type="button">지도 보기<br>Map</button>
      <button class="action-btn secondary" data-detail="${escapeHtml(r.id)}" type="button">상세 정보<br>Details</button>
      <button class="action-btn secondary" data-fav="${escapeHtml(r.id)}" type="button">${isFav?'★ 저장됨':'☆ 즐겨찾기'}<br>${isFav?'Saved':'Favorite'}</button>
      <a class="action-btn" href="${youtubeOpen(r)}" target="_blank" rel="noopener">먹방 검색<br>YouTube</a>
    </div>
  </article>`;
}
function renderPlaces(){
  const list = filtered();
  $('#restaurantGrid').innerHTML = list.length ? list.map(placeCard).join('') : `<div class="info-box"><strong>검색 결과 없음 / No results</strong><p>필터를 줄이거나 다른 검색어를 입력해 주세요.<br>Please reduce filters or try another keyword.</p></div>`;
  $$('#chipBar .chip').forEach(b=>b.classList.toggle('active', b.dataset.cat===state.category));
  $('#categorySelect').value = state.category;
}

function initMap(){
  if (!window.L) {
    $('#map').hidden = true;
    $('#mapFallback').hidden = false;
    setStatus('지도 라이브러리를 불러오지 못했습니다 / Map library failed', 'error');
    setExternalLinks(campus);
    return;
  }
  map = L.map('map', { zoomControl:true, scrollWheelZoom:true }).setView([35.9622, 126.9580], 16);
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    crossOrigin: true
  });
  let loadedTiles = 0;
  let erroredTiles = 0;
  tiles.on('tileload', () => { loadedTiles += 1; setStatus('실제 지도 표시 완료 / Interactive map loaded'); });
  tiles.on('tileerror', () => {
    erroredTiles += 1;
    if (erroredTiles > 3 && loadedTiles === 0) {
      setStatus('지도 타일을 불러오지 못했습니다. 인터넷 연결을 확인하세요 / Map tiles failed', 'warn');
    }
  });
  tiles.addTo(map);
  campusMarker = L.marker([campus.lat, campus.lng], { icon: markerIcon('campus') }).addTo(map)
    .bindPopup(`<div class="map-popup"><b>${escapeHtml(campus.nameKo)}</b><small>${escapeHtml(campus.nameEn)}</small>${escapeHtml(campus.address)}</div>`);
  restaurants.forEach(r => {
    const m = L.marker([r.lat, r.lng], { icon: markerIcon('', r.category) }).addTo(map)
      .bindPopup(`<div class="map-popup"><b>${typeIcon(r.category)} ${escapeHtml(r.nameKo)}</b><small>${escapeHtml(r.nameEn)} · ${escapeHtml(r.subCategory||'')}</small><button class="action-btn orange" data-detail="${escapeHtml(r.id)}" type="button">상세 정보 / Details</button></div>`);
    m.on('click', ()=>selectPlace(r.id, false));
    markers.set(r.id, m);
  });
  setExternalLinks(campus);
  const bounds = L.latLngBounds(restaurants.map(r => [r.lat, r.lng]));
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.16), { maxZoom: 16 });
  setStatus('지도 불러오는 중 / Loading map...');
  map.whenReady(() => {
    map.invalidateSize();
    setTimeout(()=>map.invalidateSize(), 200);
    setTimeout(()=>map.invalidateSize(), 800);
  });
}
function markerIcon(kind, category){
  const typeClass = category === '카페' ? 'cafe' : 'food';
  const cls = kind === 'campus' ? 'place-marker campus' : kind === 'selected' ? `place-marker selected ${typeClass}` : `place-marker ${typeClass}`;
  const symbol = category === '카페' ? '☕' : '🍽';
  return L.divIcon({ className:'', html:`<div class="${cls}"><span>${kind==='campus'?'W':symbol}</span></div>`, iconSize:[34,34], iconAnchor:[17,34], popupAnchor:[0,-30] });
}
function userIcon(){
  return L.divIcon({ className:'', html:'<div class="user-marker"></div>', iconSize:[26,26], iconAnchor:[13,13] });
}
function setExternalLinks(place){
  $('#selectedMapName').textContent = `${place.nameKo} / ${place.nameEn || ''}`;
  $('#selectedMapAddress').textContent = place.address;
  $('#openGoogle').href = googleOpen(place);
  $('#openNaver').href = naverOpen(place);
  $('#openKakao').href = kakaoOpen(place);
}
function selectPlace(id, pan=true){
  const r = restaurants.find(x=>x.id===id); if(!r) return;
  state.selectedId = id;
  setExternalLinks(r);
  const d = distanceFromUser(r);
  $('#distanceHint').innerHTML = d == null ? '현재 위치를 허용하면 이 식당까지의 거리를 볼 수 있습니다.<br><small>Allow location to see distance to this place.</small>' : `현재 위치에서 ${distanceLabel(r)}<br><small>${distanceLabel(r)} from your current location.</small>`;
  markers.forEach((m,key)=>{ const item = restaurants.find(x=>x.id===key); m.setIcon(markerIcon(key===id?'selected':'', item?.category)); });
  const marker = markers.get(id);
  if(map && marker){
    if (pan) map.setView([r.lat, r.lng], 17, { animate:true });
    marker.openPopup();
  }
  renderPlaces();
}
function centerCampus(){
  if(map) map.setView([campus.lat, campus.lng], 16, { animate:true });
  setExternalLinks(campus);
  setStatus('캠퍼스 중심으로 이동 / Centered on campus');
}
function centerMe(){
  if (!state.user) { requestLocation(); return; }
  if(map) map.setView([state.user.lat, state.user.lng], 16, { animate:true });
  setStatus('현재 위치로 이동 / Centered on your location');
}
function requestLocation(){
  if (!('geolocation' in navigator)) {
    setStatus('이 브라우저는 현재 위치를 지원하지 않습니다 / Geolocation not supported', 'error');
    return;
  }
  setStatus('현재 위치 권한을 요청하는 중 / Requesting location...', 'warn');
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude, longitude, accuracy } = pos.coords;
    state.user = { lat:latitude, lng:longitude, accuracy };
    if(map){
      if (userMarker) userMarker.setLatLng([latitude, longitude]);
      else userMarker = L.marker([latitude, longitude], { icon:userIcon(), zIndexOffset:1000 }).addTo(map).bindPopup('현재 위치 / You are here');
      if (userCircle) userCircle.setLatLng([latitude, longitude]).setRadius(Math.min(accuracy || 50, 300));
      else userCircle = L.circle([latitude, longitude], { radius:Math.min(accuracy || 50, 300), color:'#1967D2', fillColor:'#1967D2', fillOpacity:.08, weight:1 }).addTo(map);
      const campusDistance = haversineKm(latitude, longitude, campus.lat, campus.lng);
      if (campusDistance < 8) map.setView([latitude, longitude], 16, { animate:true });
      else map.setView([campus.lat, campus.lng], 14, { animate:true });
    }
    state.sort = 'distance';
    $('#sortSelect').value = 'distance';
    const nearest = [...restaurants].sort((a,b)=>distanceFromUser(a)-distanceFromUser(b))[0];
    updateNearestStat();
    renderPlaces();
    if (nearest) selectPlace(nearest.id, false);
    setStatus('현재 위치 연결 완료 / Current location connected');
  }, err => {
    const msg = err.code === 1 ? '위치 권한이 거부되었습니다 / Location permission denied' : err.code === 2 ? '현재 위치를 확인할 수 없습니다 / Position unavailable' : '위치 확인 시간이 초과되었습니다 / Location timeout';
    setStatus(msg, 'error');
  }, { enableHighAccuracy:true, timeout:12000, maximumAge:300000 });
}

function renderRoutes(){
  $('#routeGrid').innerHTML = routes.map(route => {
    const steps = route.ids.map(id => restaurants.find(r=>r.id===id)).filter(Boolean).map((r,i)=>`<div class="route-step"><span>${i+1}. ${escapeHtml(r.nameKo)}<small>${escapeHtml(r.nameEn)}</small></span><b>${escapeHtml(r.category)}</b></div>`).join('');
    return `<article class="route-card"><h3>${escapeHtml(route.title)}<small>${escapeHtml(route.titleEn||'')}</small></h3><p>${escapeHtml(route.desc)}<br><small>${escapeHtml(route.descEn||'')}</small></p>${steps}</article>`;
  }).join('');
}
function renderCulture(){
  $('#cultureGrid').innerHTML = cultureTips.map(t => `<article class="culture-card"><h3>${escapeHtml(t.title)}<small>${escapeHtml(t.titleEn||'')}</small></h3><p>${escapeHtml(t.body)}<br><small>${escapeHtml(t.bodyEn||'')}</small></p><code>${escapeHtml(t.phrase)}<br>${escapeHtml(t.phraseEn||'')}</code></article>`).join('');
}
function showDetail(id){
  const r = restaurants.find(x=>x.id===id); if (!r) return;
  const isFav = favs.includes(r.id);
  $('#detailContent').innerHTML = `<div class="detail-title"><h2>${escapeHtml(r.nameKo)}<small>${escapeHtml(r.nameEn)}</small></h2><p class="address">📍 ${escapeHtml(r.address)} · ${distanceLabel(r)}</p></div>
    <div class="meta"><span>${escapeHtml(r.category)} / ${escapeHtml(categoryEn[r.category]||r.category)}</span><span>${priceText(r.priceLevel)}</span><span>${spiceText(r.spice)}</span><span>${escapeHtml(r.area||'')}</span></div>
    <div class="detail-grid">
      <div class="info-box"><strong>대표 메뉴 / Popular menu</strong><div class="menu-list">${r.menus.map(m=>`<div class="menu-item"><span>${escapeHtml(m.ko)}<small>${escapeHtml(m.en||'')}</small></span><strong>${won(m.price)}</strong></div>`).join('')}</div></div>
      <div class="info-box"><strong>식문화 설명 / Food culture</strong><p>${escapeHtml(r.foodKo)}<br><small>${escapeHtml(r.foodEn)}</small></p><p>${escapeHtml(r.cultureKo||'')}<br><small>${escapeHtml(r.cultureEn||'')}</small></p></div>
      <div class="info-box"><strong>주문 표현 / Order phrase</strong><p>“${escapeHtml(r.orderPhraseKo)}”<br><small>“${escapeHtml(r.orderPhraseEn)}”</small></p></div>
      <div class="info-box"><strong>운영 정보 / Store info</strong><p>영업시간: ${escapeHtml(r.hours||'확인 필요')}<br>전화: ${escapeHtml(r.phone||'확인 필요')}<br>휴무: ${escapeHtml(r.closed||'확인 필요')}</p></div>
    </div>
    <div class="review-box info-box"><strong>내 메모 / My note</strong><textarea id="reviewText" placeholder="방문 후 메모를 남겨 보세요 / Write your note after visiting">${escapeHtml(reviews[r.id]||'')}</textarea><button class="action-btn orange" id="saveReview" type="button">메모 저장 / Save note</button></div>
    <div class="dialog-actions"><button class="action-btn orange" data-map="${escapeHtml(r.id)}" type="button">지도 보기 / Map</button><a class="action-btn" href="${googleOpen(r)}" target="_blank" rel="noopener">Google</a><a class="action-btn" href="${naverOpen(r)}" target="_blank" rel="noopener">Naver</a><a class="action-btn" href="${kakaoOpen(r)}" target="_blank" rel="noopener">Kakao</a><button class="action-btn secondary" data-fav="${escapeHtml(r.id)}" type="button">${isFav?'★ Saved':'☆ Favorite'}</button></div>
    <p class="source-note">출처 / Source: ${r.sourceUrl ? `<a href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(r.sourceLabel||'source')}</a>` : escapeHtml(r.sourceLabel||'확인 필요')} · 확인일 / Checked: ${escapeHtml(r.checkedDate||'')}</p>`;
  $('#saveReview').addEventListener('click', () => { reviews[r.id] = $('#reviewText').value.trim(); saveReviews(); alert('저장 완료 / Saved'); });
  $('#detailDialog').showModal();
}

function setControlPanel(open){
  const panel = $('#controlPanel');
  const toggle = $('#menuToggle');
  const status = $('#menuToggleStatus');
  if (!panel || !toggle || !status) return;
  panel.classList.toggle('collapsed', !open);
  toggle.setAttribute('aria-expanded', String(open));
  status.textContent = open ? '닫기 Close' : '열기 Open';
  setTimeout(()=>{ if (map) map.invalidateSize(); }, 280);
}
function toggleControlPanel(){
  const panel = $('#controlPanel');
  if (!panel) return;
  setControlPanel(panel.classList.contains('collapsed'));
}

function bindEvents(){
  $('#menuToggle')?.addEventListener('click', toggleControlPanel);
  $('#searchInput').addEventListener('input', e=>{ state.q=e.target.value.trim(); renderPlaces(); });
  $('#categorySelect').addEventListener('change', e=>{ state.category=e.target.value; renderPlaces(); });
  $('#priceSelect').addEventListener('change', e=>{ state.price=e.target.value; renderPlaces(); });
  $('#spiceSelect').addEventListener('change', e=>{ state.spice=e.target.value; renderPlaces(); });
  $('#sortSelect').addEventListener('change', e=>{ state.sort=e.target.value; if(state.sort==='distance'&&!state.user) setStatus('거리순은 현재 위치 허용 후 정확해집니다 / Distance sort needs location', 'warn'); renderPlaces(); });
  $('#favOnlyBtn').addEventListener('click', e=>{ state.favOnly=!state.favOnly; e.currentTarget.classList.toggle('active', state.favOnly); renderPlaces(); });
  $('#chipBar').addEventListener('click', e=>{ const btn=e.target.closest('[data-cat]'); if(!btn) return; state.category=btn.dataset.cat; renderPlaces(); });
  $$('.use-location').forEach(btn => btn.addEventListener('click', requestLocation));
  $('#centerCampusBtn').addEventListener('click', centerCampus);
  $('#centerMeBtn').addEventListener('click', centerMe);
  document.addEventListener('click', e=>{
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) { const id=favBtn.dataset.fav; favs = favs.includes(id) ? favs.filter(x=>x!==id) : [...favs,id]; saveFavs(); renderPlaces(); return; }
    const detailBtn = e.target.closest('[data-detail]');
    if (detailBtn) { showDetail(detailBtn.dataset.detail); return; }
    const mapBtn = e.target.closest('[data-map]');
    if (mapBtn) { setControlPanel(false); selectPlace(mapBtn.dataset.map, true); document.querySelector('#map-section').scrollIntoView({behavior:'smooth'}); return; }
  });
  $('#closeDialog').addEventListener('click', ()=>$('#detailDialog').close());
}

document.addEventListener('DOMContentLoaded', () => {
  initStats(); initFilters(); renderPlaces(); renderRoutes(); renderCulture(); bindEvents(); setControlPanel(false); initMap();
  window.addEventListener('resize', () => { if (map) map.invalidateSize(); });
  window.addEventListener('orientationchange', () => { setTimeout(() => { if (map) map.invalidateSize(); }, 350); });
});
