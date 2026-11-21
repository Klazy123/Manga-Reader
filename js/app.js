/* KRD Manga Reader v5 — быстрое перелистывание с предзагрузкой, плавная главная. */
(() => {
'use strict';
const DATA=window.MANGA_DATA, CFG=window.KRD_CONFIG || {};
const ready=Boolean(CFG.supabaseUrl?.startsWith('https://') && CFG.supabasePublishableKey && !CFG.supabasePublishableKey.startsWith('PASTE_'));
const db=ready && window.supabase ? window.supabase.createClient(CFG.supabaseUrl,CFG.supabasePublishableKey) : null;
const $=(q,parent=document)=>parent.querySelector(q);
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const getLocal=(k,d)=>{try {const a=localStorage.getItem('krd3.'+k);return a===null?d:JSON.parse(a)}catch{return d}};
const setLocal=(k,v)=>{try{localStorage.setItem('krd3.'+k,JSON.stringify(v))}catch{}};
const state={user:null,profile:null,logins:[],volumes:[],favorites:new Set(),progress:{},ratings:[],comments:[],theme:getLocal('theme','classic'),mode:getLocal('mode','webtoon'),zoom:getLocal('zoom',100),query:'',page:1,readerKey:'',themeOpen:false,menuOpen:false,loading:true,adminEdit:null,ambient:getLocal('ambient','none')};
let epoch=0,observer=null,audioEl=null,toastTimer=null;
const privateBlobs=new Map();
const privateDownloads=new Map(); // Один сетевой запрос на один файл, даже при одновременной предзагрузке.
let privateCacheGeneration=0,pageLoadRequest=0;
function clearPrivateCache(){
  privateCacheGeneration++;
  for(const url of privateBlobs.values())URL.revokeObjectURL(url);
  privateBlobs.clear();privateDownloads.clear();
}
if(!DATA.themes.some(t=>t.id===state.theme))state.theme='classic';
if(!['webtoon','paged'].includes(state.mode))state.mode='webtoon';
state.zoom=Math.min(160,Math.max(60,Number(state.zoom)||100));
document.body.dataset.theme=state.theme;
document.documentElement.style.setProperty('--reader-width',Math.round(790*state.zoom/100)+'px');
const uid=()=>state.user?.id;
const isAdmin=()=>state.profile?.role==='admin' && state.profile?.username?.toLowerCase()==='katsuro';
const icon=(name,size=18)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',book:'<path d="M12 7v14M3 18V5a2 2 0 0 1 2-2h4a3 3 0 0 1 3 3 3 3 0 0 1 3-3h4a2 2 0 0 1 2 2v13"/>',heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',palette:'<path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 1.7-4.4 1.5 1.5 0 0 1 1-2.6H18a3 3 0 0 0 3-3 9 9 0 0 0-9-8z"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',back:'<path d="M19 12H5m6 6-6-6 6-6"/>',comment:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5a9 9 0 0 1-.9-4A8.5 8.5 0 1 1 21 11.5z"/>',menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',star:'<path d="m12 2 3 6 6.5 1-4.7 4.6 1.1 6.4L12 17l-5.9 3 1.1-6.4L2.5 9 9 8z"/>',sound:'<path d="M4 9v6h4l5 4V5L8 9H4zm13-1a6 6 0 0 1 0 8m2-11a10 10 0 0 1 0 14"/>'})[name]||''}</svg>`;
const parseRoute=()=>{const [p,q='']=(decodeURIComponent(location.hash.slice(1))||'/').split('?');const a=p.split('/').filter(Boolean);return {kind:a[0]||'home',vid:a[1],cid:a[2],page:Number(new URLSearchParams(q).get('page'))||1}};
const vol=id=>state.volumes.find(x=>x.id===id);
const chap=(v,id)=>v?.chapters.find(x=>x.id===id);
const vlink=v=>`#/volume/${v.id}`;
const clink=(v,c)=>`#/read/${v.id}/${c.id}`;
const progKey=c=>c.id;
const totalPages=c=>c?.pages?.length||0;
const allChapters=()=>state.volumes.flatMap(v=>v.chapters.map(c=>({v,c})));
const savedPage=c=>state.progress[c.id]?.page_number||0;
const themeItem=t=>`<button class="theme-choice ${state.theme===t.id?'is-active':''}" data-action="theme" data-id="${t.id}"><span class="theme-choice__art theme-preview-${t.id}">${esc(t.symbol)}</span>${esc(t.name)}</button>`;
function toast(msg){const el=$('#toast');if(!el)return;el.textContent=msg;el.classList.add('is-visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('is-visible'),4500)}
function explain(error){return error?.message || String(error||'Неизвестная ошибка')}
function notifyError(error){console.error(error);toast(explain(error))}
function check(result){if(result.error)throw result.error;return result.data}
function renderHeader(){const r=parseRoute();$('#siteHeader').innerHTML=`<header class="site-header"><div class="site-container site-header__inner"><a href="#/" class="brand"><span class="brand__seal">滅</span><span>Satsuta No Yaiba</span></a><nav class="header-nav"><a href="#/" class="${r.kind==='home'?'is-active':''}">${icon('home')} Главная</a><a href="#/library" class="${r.kind==='library'?'is-active':''}">${icon('book')} Библиотека</a><a href="#/favorites" class="${r.kind==='favorites'?'is-active':''}">${icon('heart')} Избранное</a>${isAdmin()?`<a href="#/admin" class="${r.kind==='admin'?'is-active':''}">⚙ Админ</a>`:''}</nav><div class="header-actions"><button class="icon-btn" data-action="themes" aria-label="Темы">${icon('palette',22)}</button>${state.user?`<span class="user-chip">${esc(state.profile?.username||'Читатель')}</span><button class="btn btn--small" data-action="logout">Выход</button>`:`<button class="btn btn--small" data-action="login-screen">Войти</button>`}<button class="icon-btn mobile-toggle" data-action="menu">${icon('menu',22)}</button>${state.themeOpen?`<div class="theme-popover"><h3>Тема оформления</h3><div class="theme-popover__grid">${DATA.themes.map(themeItem).join('')}</div></div>`:''}</div></div>${state.menuOpen?`<div class="mobile-nav"><a href="#/">Главная</a><a href="#/library">Библиотека</a><a href="#/favorites">Избранное</a>${isAdmin()?'<a href="#/admin">Админ-панель</a>':''}</div>`:''}</header>`;}
function renderFooter(){$('#siteFooter').innerHTML=`<footer class="site-footer"><div class="site-container site-footer__inner"><span><strong>Satsuta No Yaiba</strong> · Место, где живут истории</span><span>${ready?'by Klazy':'Ожидается настройка Supabase'}</span></div></footer>`;}
function renderLogin(){return `<div class="site-container login-wrap"><div class="login-card"><span class="eyebrow">KRD MANGA · PRIVATE LIBRARY</span><h1>Добро пожаловать</h1><p>Для чтения глав, оценок и комментариев нужно войти. Выбери свой никнейм и введи пароль.</p>${!db?`<div class="setup-warning">База ещё не подключена. Открой <code>js/config.js</code> и заполни Project URL и Publishable key, затем выполни инструкцию из README.md.</div>`:''}<form id="loginForm"><label for="loginNick">Никнейм</label><select id="loginNick" required ${!db?'disabled':''}><option value="">Выбери никнейм</option>${state.logins.map(u=>`<option value="${esc(u.username)}">${esc(u.username)}</option>`).join('')}</select><label for="loginPass">Пароль</label><input id="loginPass" type="password" minlength="1" autocomplete="current-password" required placeholder="Пароль аккаунта"><button class="btn btn--primary" type="submit" ${!db?'disabled':''}>Войти ${icon('arrow')}</button></form><small>Аккаунты создаются заранее администратором. Самостоятельная регистрация отключена.</small></div></div>`;}
function cover(v){return v.cover_url||'assets/covers/volume-1.png'}
function volumeCard(v){const fav=state.favorites.has(v.id);return `<div class="volume-card"><a class="volume-card__link" href="${vlink(v)}"><div class="volume-card__img"><img src="${esc(cover(v))}" alt="Обложка ${esc(v.title)}" loading="lazy"><span class="volume-card__num">ТОМ ${v.number}</span></div><div class="volume-card__body"><h3>${esc(v.title)}</h3><p>${esc(v.subtitle)}</p><div class="volume-card__bottom"><span>☷ ${v.chapters.length} глав</span><span class="volume-card__arrow">↗</span></div></div></a><button class="card-fav ${fav?'is-active':''}" aria-pressed="${fav}" aria-label="${fav?'Убрать из избранного':'В избранное'}" data-action="favorite" data-id="${v.id}">${fav?'♥':'♡'}</button></div>`;}
function filtered(favs=false){const q=state.query.toLowerCase().trim();return state.volumes.filter(v=>(!favs||state.favorites.has(v.id)) && (!q||[v.title,v.subtitle,v.description,...v.genres].join(' ').toLowerCase().includes(q)));}
function gridHTML(favs=false){const a=filtered(favs);return a.length?a.map(volumeCard).join(''):`<div class="empty-state"><h3>${favs?'В избранном пока пусто':'Пока нет томов'}</h3><p>${favs?'Добавь том кнопкой ♡. Её можно нажать повторно, чтобы удалить том из избранного.':isAdmin()?'Открой админ-панель и загрузи первый том.':'Скоро здесь появятся истории.'}</p></div>`;}
function renderHome(kind='home'){const home=kind==='home',favs=kind==='favorites';return `${home?`<section class="hero"><div class="site-container hero__inner"><div class="hero__copy"><span class="eyebrow">Твоя манга. Твои правила.</span><h1 class="hero__title">Satsuta <span>No Yaiba</span></h1><p class="hero__desc">Погрузись в истории. Читай, комментируй и возвращайся к сохранённой странице.</p><div class="hero__buttons"><a href="#/library" class="btn btn--primary">Открыть библиотеку ${icon('arrow')}</a></div></div><div class="hero__watermark">影</div><img class="hero__art" src="assets/hero-character.png" alt="Аниме-персонаж справа от логотипа"></div></section>`:''}<div class="site-container"><section class="section" id="library"><div class="section-heading"><div class="section-heading__left"><span class="section-heading__mark">✿</span><div><h2>${favs?'Избранное':home?'Список томов':'Библиотека'}</h2><p>Выбирай историю и продолжай чтение</p></div></div><span class="section-counter" id="resultCounter">${filtered(favs).length} томов</span></div><div class="catalog-search"><input id="catalogSearch" type="search" placeholder="Поиск по томам, жанрам..." value="${esc(state.query)}"></div><div class="volume-grid" id="volumeGrid">${gridHTML(favs)}</div></section>${home?`<section class="section themes-strip" id="themes"><div class="section-heading"><div class="section-heading__left"><span class="section-heading__mark">◈</span><div><h2>Темы оформления</h2><p>Выбирай своё настроение</p></div></div></div><div class="theme-grid">${DATA.themes.map(t=>`<button class="theme-tile ${state.theme===t.id?'is-active':''}" data-action="theme" data-id="${t.id}"><span class="theme-tile__art theme-preview-${t.id}">${esc(t.symbol)}</span><strong>${esc(t.name)}</strong><small>${esc(t.detail)}</small></button>`).join('')}</div></section>`:''}</div>`;}
function chapterStatus(c){const p=savedPage(c);return !p?'Не начато':p>=totalPages(c)?'✓ Последняя страница':`Стр. ${p} / ${totalPages(c)}`}
function ratingInfo(v){const a=state.ratings.filter(r=>r.volume_id===v.id);return {count:a.length, avg:a.length?a.reduce((s,x)=>s+x.stars,0)/a.length:0,own:a.find(x=>x.user_id===uid())?.stars||0}}
function renderVolume(v){const first=v.chapters[0],resume=v.chapters.find(c=>savedPage(c)&&savedPage(c)<totalPages(c))||first,fav=state.favorites.has(v.id),rating=ratingInfo(v);return `<div class="site-container"><div class="breadcrumbs"><a href="#/">Главная</a> › <a href="#/library">Библиотека</a> › Том ${v.number}</div><div class="volume-layout"><aside class="volume-sidebar"><img class="volume-cover" src="${esc(cover(v))}" alt="${esc(v.title)}"><p class="volume-sidebar__hint">Твой прогресс сохраняется на сервере.</p></aside><article class="volume-details"><div class="volume-details__eyebrow">ТОМ ${v.number} · KRD Manga</div><h1>${esc(v.title)}</h1><p class="volume-details__subtitle">${esc(v.subtitle)}</p><div class="badges"><span class="tag">◷ ${esc(v.year)}</span><span class="tag">◈ ${esc(v.status)}</span><span class="tag">☷ ${v.chapters.length} глав</span>${v.genres.map(g=>`<span class="tag">${esc(g)}</span>`).join('')}</div><div class="volume-details__desc">${esc(v.description)}</div><div class="volume-details__actions">${resume?`<a href="${clink(v,resume)}" class="btn btn--primary">${icon('book')} ${savedPage(resume)?'Продолжить чтение':'Читать'}</a>`:''}<button class="btn" data-action="favorite" data-id="${v.id}">${icon('heart')} ${fav?'Убрать из избранного':'В избранное'}</button>${isAdmin()?`<a class="btn" href="#/admin?edit=${v.id}">Редактировать</a>`:''}</div><div class="detail-block"><h2>Содержание</h2><p>${esc(v.contents)}</p></div><div class="rating-panel"><h2>Оценка тома</h2><div class="rating-summary">${icon('star',23)} <strong>${rating.count?rating.avg.toFixed(2):'—'} / 10</strong><span>(${rating.count} оценок)</span></div><p>Твоя оценка: ${rating.own?rating.own+'/10':'пока нет'}</p><div class="rating-buttons" aria-label="Поставить оценку от 1 до 10">${Array.from({length:10},(_,i)=>`<button title="${i+1} из 10" class="${rating.own>=i+1?'chosen':''}" data-action="rate" data-id="${v.id}" data-value="${i+1}" aria-label="${i+1} из 10">★</button>`).join('')}</div></div></article></div><section class="chapters-panel"><div class="chapters-panel__head"><h2>Список глав</h2><span class="section-counter">Всего ${v.chapters.length}</span></div><div class="chapters-list">${v.chapters.length?v.chapters.map(c=>`<a class="chapter-row" href="${clink(v,c)}"><span class="chapter-row__number">${c.number}</span><span class="chapter-row__body"><h3>Глава ${c.number}. ${esc(c.title)}</h3><p>${esc(c.summary)}</p></span><span class="chapter-row__state">${chapterStatus(c)}</span><span class="chapter-row__chev">›</span></a>`).join(''):'<p class="empty-state">Глав пока нет.</p>'}</div></section></div>`;}
function commentsMarkup(c){const a=state.comments.filter(x=>x.chapter_id===c.id);return `<section class="comments" id="commentsSection"><div class="comments__title"><h2>${icon('comment')} Комментарии к главе</h2><span class="comments__count">${a.length}</span></div><p class="comments__hint">Общее обсуждение главы ${c.number}: комментарии видны на любой её странице, в обоих режимах чтения. Удалить можно только свой.</p><form id="commentForm" data-chapter="${c.id}"><textarea name="body" rows="3" maxlength="1000" placeholder="Что думаешь об этой главе?" required></textarea><button class="btn btn--primary" type="submit">Отправить ${icon('arrow')}</button></form><div class="comments-list">${a.length?a.map(x=>`<article class="comment-item"><span class="comment-item__avatar">${esc((x.profiles?.username||'?')[0])}</span><div class="comment-item__content"><div class="comment-item__top"><strong>${esc(x.profiles?.username||'Читатель')}</strong><time>${new Date(x.created_at).toLocaleString('ru-RU')}</time>${x.user_id===uid()?`<button class="comment-item__delete" data-action="delete-comment" data-id="${x.id}">Удалить</button>`:''}</div><p>${esc(x.body)}</p></div></article>`).join(''):'<div class="comment-empty">Начни обсуждение этой главы!</div>'}</div></section>`;}

function soundSelect(){const SOUNDS=window.KRD_SOUNDS||[];return `<div class="sound-control">${icon('sound')}<label for="soundSelect">Звук</label><select id="soundSelect"><option value="none">Выключен</option>${SOUNDS.map(s=>`<option value="${esc(s.id)}" ${state.ambient===s.id?'selected':''}>${esc(s.title)}</option>`).join('')}</select><button type="button" class="reader-toolbtn" data-action="audio-toggle" aria-label="Пауза или воспроизведение">${audioEl&&!audioEl.paused?'Ⅱ':'▶'}</button></div>`;}
function readerImage(p,c,index){return `<img loading="${index<2?'eager':'lazy'}" decoding="async" src="${esc(p.url||'')}" alt="Глава ${c.number}, страница ${p.page_number}" data-page-index="${p.page_number}">`}
function renderReader(v,c){const entries=allChapters(),idx=entries.findIndex(x=>x.c.id===c.id),prev=entries[idx-1],next=entries[idx+1],paged=state.mode==='paged',max=totalPages(c);state.page=Math.min(max,Math.max(1,state.page));const page=state.page,pages=paged?[c.pages[page-1]]:c.pages;return `<div class="site-container reader-page"><div class="breadcrumbs"><a href="#/library">Библиотека</a> › <a href="${vlink(v)}">Том ${v.number}</a> › Глава ${c.number}</div><div class="reader-heading"><div><h1>Глава ${c.number}. ${esc(c.title)}</h1><p>${esc(v.title)} · ${max} страниц</p></div><a href="${vlink(v)}" class="btn btn--small">${icon('back')} К главам</a></div><div class="reader-tools" role="toolbar"><div class="reader-mode"><button data-action="mode" data-id="webtoon" class="${!paged?'is-active':''}">▥ Вебтун</button><button data-action="mode" data-id="paged" class="${paged?'is-active':''}">▣ Постраничный</button></div><div class="reader-zoom"><span class="reader-zoom__caption">Масштаб</span><button class="reader-toolbtn" data-action="zoom-minus">−</button><input id="zoomRange" type="range" min="60" max="160" step="10" value="${state.zoom}"><output id="zoomValue">${state.zoom}%</output><button class="reader-toolbtn" data-action="zoom-plus">+</button></div>${soundSelect()}<span class="reader-counter">${paged?`${page} / ${max}`:'Вебтун'}</span></div><div class="reader-stage"><div class="reader-stage__label">${paged?'Нажми слева/справа на изображение':'Листай вниз — вебтун'}</div><div class="reader-images reader-images--${paged?'paged':'webtoon'}">${pages.map((p,i)=>readerImage(p,c,i)).join('')}${paged?`<button class="page-hit page-hit--left" data-action="prev-page" aria-label="Предыдущая страница" ${page===1?'disabled':''}></button><button class="page-hit page-hit--right" data-action="next-page" aria-label="Следующая страница" ${page===max?'disabled':''}></button>`:''}</div>${paged?`<nav class="reader-pager"><button class="btn" data-action="prev-page" ${page===1?'disabled':''}>← Назад</button><span class="reader-pager__count">${page} / ${max}</span><button class="btn" data-action="next-page" ${page===max?'disabled':''}>Вперёд →</button></nav>`:''}</div>${commentsMarkup(c)}<div class="reader-end"><h2>Продолжить путешествие</h2><div class="reader-end__buttons">${prev?`<a class="btn" href="${clink(prev.v,prev.c)}">← Пред. глава</a>`:''}${next?`<a class="btn btn--primary" href="${clink(next.v,next.c)}">След. глава →</a>`:''}<a class="btn" href="${vlink(v)}">Список глав</a></div></div></div>`;}
function renderAdmin(r){const editing=vol(r.vid||new URLSearchParams(location.hash.split('?')[1]||'').get('edit'));const v=editing;return `<div class="site-container admin-root"><div class="breadcrumbs"><a href="#/">Главная</a> › Админ-панель</div><h1>Панель Katsuro</h1><p>Создание, редактирование и удаление томов и глав. Все изменения сохраняются в Supabase.</p><div class="admin-grid"><section class="admin-box"><h2>${v?'Редактировать том':'Добавить том'}</h2><form id="volumeForm" data-id="${v?.id||''}"><label>Номер тома<input type="number" name="number" min="1" required value="${v?.number||state.volumes.length+1}"></label><label>Название<input name="title" required maxlength="150" value="${esc(v?.title||'')}"></label><label>Подзаголовок<input name="subtitle" value="${esc(v?.subtitle||'')}"></label><label>Описание<textarea name="description" rows="4">${esc(v?.description||'')}</textarea></label><label>Содержание<textarea name="contents" rows="3">${esc(v?.contents||'')}</textarea></label><label>Год<input name="year" value="${esc(v?.year||'2026')}"></label><label>Статус<input name="status" value="${esc(v?.status||'В процессе')}"></label><label>Жанры (через запятую)<input name="genres" value="${esc(v?.genres?.join(', ')||'')}"></label><label>Обложка PNG/JPG/WebP <input type="file" name="cover" accept="image/png,image/jpeg,image/webp,image/avif" ${v?'':'required'}></label><button class="btn btn--primary">${v?'Сохранить изменения':'Создать том'}</button>${v?`<a class="btn" href="#/admin">Отмена</a>`:''}</form></section><section class="admin-box"><h2>Загрузить главу</h2><form id="chapterForm"><label>Том<select name="volume_id" required><option value="">Выбери том</option>${state.volumes.map(x=>`<option value="${x.id}" ${v?.id===x.id?'selected':''}>Том ${x.number} — ${esc(x.title)}</option>`).join('')}</select></label><label>Номер главы<input type="number" name="number" min="1" required></label><label>Название<input name="title" required></label><label>Описание<input name="summary"></label><label>Изображения страниц (несколько сразу)<input type="file" name="pages" accept="image/png,image/jpeg,image/webp,image/avif" multiple required></label><p class="admin-help">Файлы сортируются по имени: 001.jpg, 002.jpg, 003.jpg. Максимум 50 МБ на файл.</p><button class="btn btn--primary" type="submit">Загрузить главу</button></form><div class="admin-progress" id="adminProgress" aria-live="polite"></div></section></div><section class="admin-box"><h2>Существующие тома и главы</h2>${state.volumes.map(x=>`<div class="admin-volume"><div class="admin-row"><strong>Том ${x.number}: ${esc(x.title)}</strong><span><a class="btn btn--small" href="#/admin?edit=${x.id}">Редактировать</a> <button class="btn btn--small" data-action="delete-volume" data-id="${x.id}">Удалить том</button></span></div>${x.chapters.map(c=>`<div class="admin-row admin-chapter"><span>Глава ${c.number}: ${esc(c.title)} · ${c.pages.length} стр.</span><span><button class="btn btn--small" data-action="edit-chapter" data-id="${c.id}" data-volume="${x.id}">Изменить</button> <button class="btn btn--small" data-action="delete-chapter" data-id="${c.id}" data-volume="${x.id}">Удалить</button></span></div>`).join('')}</div>`).join('')||'<p>Тома пока не созданы.</p>'}${!state.volumes.length?`<div class="admin-demo"><p>Можно загрузить демонстрационную библиотеку из предыдущей версии (5 томов, 16 глав, 12 повторно используемых изображений).</p><button class="btn btn--primary" data-action="import-demo">Импортировать демо-каталог</button></div>`:''}</section></div>`;}
function renderNotFound(){return '<div class="site-container not-found"><h1>Страница не найдена</h1><a class="btn" href="#/">На главную</a></div>'}
async function privateImage(path){
  if(!path)return '';
  if(privateBlobs.has(path))return privateBlobs.get(path);
  if(privateDownloads.has(path))return privateDownloads.get(path);
  const generation=privateCacheGeneration;
  const download=(async()=>{
    const file=check(await db.storage.from('krd-manga').download(path));
    const url=URL.createObjectURL(file);
    // Нельзя оставить приватную картинку в памяти после выхода из аккаунта.
    if(generation!==privateCacheGeneration){URL.revokeObjectURL(url);return '';}
    privateBlobs.set(path,url);
    return url;
  })();
  privateDownloads.set(path,download);
  try{return await download}finally{if(privateDownloads.get(path)===download)privateDownloads.delete(path)}
}
async function loadLogins(){if(!db)return;state.logins=check(await db.from('login_names').select('username,login_email').order('username'))||[];}
async function loadCatalog(){const rows=check(await db.from('volumes').select('*, chapters(id,number,title,summary,pages(id,page_number,storage_path,byte_size))').order('number'))||[];
 state.volumes=rows.map(v=>({...v,genres:v.genres||[],chapters:(v.chapters||[]).map(c=>({...c,pages:(c.pages||[]).sort((a,b)=>a.page_number-b.page_number)})).sort((a,b)=>a.number-b.number)}));
 await Promise.all(state.volumes.map(async v=>{if(v.cover_path){try{v.cover_url=await privateImage(v.cover_path)}catch(e){console.warn('cover',e)}}}));
}
async function loadPersonal(){const id=uid();if(!id)return;const [favorites,progress,ratings]=await Promise.all([db.from('favorites').select('volume_id').eq('user_id',id),db.from('reading_progress').select('chapter_id,page_number').eq('user_id',id),db.from('ratings').select('volume_id,user_id,stars')]);state.favorites=new Set(check(favorites).map(x=>x.volume_id));state.progress=Object.fromEntries(check(progress).map(x=>[x.chapter_id,x]));state.ratings=check(ratings);}
async function hydrate({showLoading=false}={}){const ticket=++epoch;if(showLoading){state.loading=true;render();}try{const {data:{session},error:sessionError}=await db.auth.getSession();if(sessionError)throw sessionError;let user=null;if(session){const authResult=await db.auth.getUser();if(authResult.error)throw authResult.error;user=authResult.data.user;}if(ticket!==epoch)return;state.user=user||null;if(user){state.profile=check(await db.from('profiles').select('username,role').eq('id',user.id).single());await Promise.all([loadCatalog(),loadPersonal()]);}else{state.profile=null;state.volumes=[];state.progress={};state.favorites=new Set();state.ratings=[];await loadLogins();}}catch(e){console.error(e);toast(explain(e));}finally{if(ticket===epoch){state.loading=false;await render();}}}
async function loadChapterAssets(c){
  // В постраничном режиме не ждём все страницы главы: нужна только текущая.
  const pages=state.mode==='paged'?[c.pages[Math.max(0,state.page-1)]].filter(Boolean):c.pages;
  await Promise.all(pages.map(async p=>{if(!p.url)p.url=await privateImage(p.storage_path)}));
}
function prefetchNearbyPages(c,page){
  // Подготавливаем следующие страницы в фоне, не блокируя кнопки чтения.
  for(const n of [page+1,page+2,page-1]){
    const p=c.pages[n-1];
    if(p&&!p.url)privateImage(p.storage_path).then(url=>{if(url)p.url=url}).catch(e=>console.warn('Не удалось предзагрузить страницу',n,e));
  }
}
function showPagedImage(c,n){
  const wrapper=$('.reader-images--paged'),img=wrapper?.querySelector('img'),p=c.pages[n-1];
  if(!img||!p)return;
  const request=++pageLoadRequest;
  img.alt=`Глава ${c.number}, страница ${p.page_number}`;
  img.dataset.pageIndex=String(p.page_number);
  const apply=url=>{
    if(!url||request!==pageLoadRequest||!img.isConnected)return;
    const current=parseRoute();
    if(current.kind!=='read'||current.cid!==c.id||state.page!==n)return;
    img.src=url;
    wrapper.classList.remove('is-page-pending');
    img.removeAttribute('aria-busy');
  };
  if(p.url){apply(p.url)}else{
    // Небольшой плейсхолдер вместо полной перерисовки читалки.
    wrapper.classList.add('is-page-pending');
    img.setAttribute('aria-busy','true');
    img.removeAttribute('src');
    privateImage(p.storage_path).then(url=>{if(url)p.url=url;apply(url)}).catch(e=>{
      if(request===pageLoadRequest&&img.isConnected){wrapper.classList.remove('is-page-pending');notifyError(e)}
    });
  }
  prefetchNearbyPages(c,n);
}
async function loadComments(c){const raw=check(await db.from('comments').select('id,chapter_id,user_id,page_number,body,created_at').eq('chapter_id',c.id).order('created_at',{ascending:false}));const profiles=check(await db.from('profiles').select('id,username'));const people=new Map(profiles.map(p=>[p.id,p]));state.comments=raw.map(x=>({...x,profiles:people.get(x.user_id)||null}));}
async function render(keepScroll=false){const ticket=++render.serial||(render.serial=1),scroll=window.scrollY,r=parseRoute();++pageLoadRequest;observer?.disconnect();observer=null;renderHeader();renderFooter();if(state.loading){$('#app').innerHTML='<div class="site-container loading-state">Загружаем библиотеку…</div>';return}if(!state.user){$('#app').innerHTML=renderLogin();return}if(r.kind==='home'||r.kind==='library'||r.kind==='favorites'){$('#app').innerHTML=renderHome(r.kind)}else if(r.kind==='volume'){const v=vol(r.vid);$('#app').innerHTML=v?renderVolume(v):renderNotFound();}else if(r.kind==='read'){const v=vol(r.vid),c=chap(v,r.cid);if(!c){$('#app').innerHTML=renderNotFound();return;}const key=c.id;if(key!==state.readerKey){state.readerKey=key;state.page=r.page>1?r.page:(savedPage(c)||1);}const activeTicket=ticket;$('#app').innerHTML='<div class="site-container loading-state">Открываем главу…</div>';try{await Promise.all([loadChapterAssets(c),loadComments(c)]);if(activeTicket!==render.serial)return;$('#app').innerHTML=renderReader(v,c);observeReader(c);saveProgress(c,state.page);restoreAudio();if(state.mode==='paged')prefetchNearbyPages(c,state.page);}catch(e){if(activeTicket===render.serial){$('#app').innerHTML=`<div class="site-container error-state"><h2>Не удалось открыть главу</h2><p>${esc(explain(e))}</p></div>`;} }}else if(r.kind==='admin'&&isAdmin()){$('#app').innerHTML=renderAdmin(r);}else $('#app').innerHTML=renderNotFound();if(keepScroll)window.scrollTo({top:scroll,behavior:'instant'});}
function observeReader(c){if(state.mode!=='webtoon'||!('IntersectionObserver' in window))return;observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)saveProgress(c,Number(e.target.dataset.pageIndex))},{rootMargin:'-15% 0px -40% 0px',threshold:0});document.querySelectorAll('.reader-images--webtoon img').forEach(i=>observer.observe(i));}
let progressTimers={};
function saveProgress(c,n){if(!uid()||!c||!n)return;const old=savedPage(c);if(n===old)return;state.progress[c.id]={chapter_id:c.id,page_number:n};clearTimeout(progressTimers[c.id]);progressTimers[c.id]=setTimeout(async()=>{const res=await db.from('reading_progress').upsert({user_id:uid(),chapter_id:c.id,page_number:n,updated_at:new Date().toISOString()},{onConflict:'user_id,chapter_id'});if(res.error)notifyError(res.error)},600)}
function changePage(n){
  const r=parseRoute(),v=vol(r.vid),c=chap(v,r.cid);
  if(!c||!totalPages(c))return;
  const next=Math.max(1,Math.min(totalPages(c),n));
  if(next===state.page)return;
  state.page=next;
  history.replaceState(null,'',clink(v,c)+`?page=${next}`);
  saveProgress(c,next);
  // ВАЖНО: не вызываем render() — комментарии, настройки и звук остаются на месте.
  if(state.mode==='paged'&&$('.reader-images--paged img')){
    const counter=$('.reader-counter'),pager=$('.reader-pager__count');
    if(counter)counter.textContent=`${next} / ${totalPages(c)}`;
    if(pager)pager.textContent=`${next} / ${totalPages(c)}`;
    document.querySelectorAll('[data-action="prev-page"]').forEach(b=>b.disabled=next===1);
    document.querySelectorAll('[data-action="next-page"]').forEach(b=>b.disabled=next===totalPages(c));
    showPagedImage(c,next);
  }else render();
  window.scrollTo({top:0,behavior:'instant'});
}
function zoom(n){state.zoom=Math.min(160,Math.max(60,Number(n)||100));setLocal('zoom',state.zoom);document.documentElement.style.setProperty('--reader-width',Math.round(790*state.zoom/100)+'px');const o=$('#zoomValue'),r=$('#zoomRange');if(o)o.textContent=state.zoom+'%';if(r)r.value=state.zoom}
function newAudio(){if(!audioEl){audioEl=new Audio();audioEl.loop=true;audioEl.preload='none';audioEl.volume=.5;audioEl.addEventListener('error',()=>toast('Файл звука не найден. Добавь его в assets/sounds/'));}return audioEl}
async function playSound(id){state.ambient=id;setLocal('ambient',id);const a=newAudio();a.pause();if(id==='none'){a.removeAttribute('src');return}const track=(window.KRD_SOUNDS||[]).find(x=>x.id===id);if(!track)return;if(!a.src.endsWith(track.file))a.src=track.file;try{await a.play()}catch(e){toast('Не удалось запустить звук. Проверь файл или настройки браузера.');console.warn(e)}}
function restoreAudio(){const s=$('#soundSelect');if(s)s.value=state.ambient;if(audioEl && !audioEl.paused && state.ambient!=='none')return;}
async function reloadAndRender(){clearPrivateCache();await Promise.all([loadCatalog(),loadPersonal()]);await render()}
async function toggleFavorite(id){const previously=state.favorites.has(id);if(previously){check(await db.from('favorites').delete().eq('user_id',uid()).eq('volume_id',id));state.favorites.delete(id);toast('Удалено из избранного')}else{check(await db.from('favorites').insert({user_id:uid(),volume_id:id}));state.favorites.add(id);toast('Добавлено в избранное')}render(true)}
async function rate(id,stars){check(await db.from('ratings').upsert({user_id:uid(),volume_id:id,stars,updated_at:new Date().toISOString()},{onConflict:'user_id,volume_id'}));state.ratings=check(await db.from('ratings').select('volume_id,user_id,stars'));render(true);toast(`Твоя оценка: ${stars}/10`)}
async function submitComment(form){const c=form.dataset.chapter,body=form.elements.body.value.trim();if(!body)return;check(await db.from('comments').insert({chapter_id:c,user_id:uid(),page_number:null,body}));const v=vol(parseRoute().vid),chapter=chap(v,c);await loadComments(chapter);const section=$('#commentsSection');if(section)section.outerHTML=commentsMarkup(chapter);toast('Комментарий сохранён ✓')}
async function deleteComment(id){check(await db.from('comments').delete().eq('id',id).eq('user_id',uid()));const v=vol(parseRoute().vid),chapter=chap(v,parseRoute().cid);await loadComments(chapter);const section=$('#commentsSection');if(section)section.outerHTML=commentsMarkup(chapter);toast('Твой комментарий удалён')}

function safeFiles(files){const a=Array.from(files||[]);if(!a.length)throw Error('Выбери изображения');for(const f of a){if(!['image/jpeg','image/png','image/webp','image/avif'].includes(f.type))throw Error('Разрешены только PNG/JPG/WebP/AVIF');if(f.size>50*1024*1024)throw Error('Один файл не должен превышать 50 МБ');}return a.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));}
async function uploadOne(file,folder){const filename=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const path=`${folder}/${crypto.randomUUID()}-${filename}`;check(await db.storage.from('krd-manga').upload(path,file,{contentType:file.type,upsert:false}));return path;}
async function saveVolume(form){if(!isAdmin())throw Error('Нет прав');const f=form.elements,id=form.dataset.id;const fields={number:Number(f.number.value),title:f.title.value.trim(),subtitle:f.subtitle.value.trim(),description:f.description.value.trim(),contents:f.contents.value.trim(),year:f.year.value.trim(),status:f.status.value.trim(),genres:f.genres.value.split(',').map(x=>x.trim()).filter(Boolean)};if(!fields.title)throw Error('Введи название');let uploaded=null;try{if(f.cover.files.length)uploaded=await uploadOne(safeFiles(f.cover.files)[0],'covers');if(uploaded)fields.cover_path=uploaded;const result=id?await db.from('volumes').update(fields).eq('id',id):await db.from('volumes').insert(fields);check(result);if(id&&uploaded){const old=vol(id)?.cover_path;if(old)await db.storage.from('krd-manga').remove([old]);}toast(id?'Том обновлён':'Том создан');await reloadAndRender();location.hash='#/admin';}catch(e){if(uploaded)await db.storage.from('krd-manga').remove([uploaded]);throw e}}
async function saveChapter(form){if(!isAdmin())throw Error('Нет прав');const f=form.elements,volume_id=f.volume_id.value,number=Number(f.number.value),title=f.title.value.trim(),summary=f.summary.value.trim(),files=safeFiles(f.pages.files);if(!volume_id||!title)throw Error('Выбери том и название');const elem=$('#adminProgress'),paths=[];let chapterId=null;try{const chapter=check(await db.from('chapters').insert({volume_id,number,title,summary}).select('id').single());chapterId=chapter.id;for(let i=0;i<files.length;i++){if(elem)elem.textContent=`Загрузка страницы ${i+1} / ${files.length}...`;paths.push({chapter_id:chapterId,page_number:i+1,storage_path:await uploadOne(files[i],`pages/${chapterId}`),byte_size:files[i].size});}check(await db.from('pages').insert(paths));toast('Глава загружена ✓');await reloadAndRender();}catch(e){if(chapterId)await db.from('chapters').delete().eq('id',chapterId);if(paths.length)await db.storage.from('krd-manga').remove(paths.map(p=>p.storage_path));throw e}finally{if(elem)elem.textContent=''}}
async function deleteChapter(v,c){if(!isAdmin()||!confirm(`Удалить главу «${c.title}» и все её страницы?`))return;check(await db.from('chapters').delete().eq('id',c.id));await db.storage.from('krd-manga').remove([...new Set(c.pages.map(p=>p.storage_path).filter(p=>p.startsWith(`pages/${c.id}/`)))]);await reloadAndRender();toast('Глава удалена')}
async function deleteVolume(v){if(!isAdmin()||!confirm(`Удалить том «${v.title}», все главы, комментарии и оценки?`))return;const paths=[v.cover_path,...v.chapters.flatMap(c=>c.pages.map(p=>p.storage_path).filter(p=>p.startsWith(`pages/${c.id}/`)))].filter(Boolean);check(await db.from('volumes').delete().eq('id',v.id));if(paths.length)await db.storage.from('krd-manga').remove([...new Set(paths)]);await reloadAndRender();toast('Том удалён')}
async function replacePages(c){
  if(!isAdmin())throw Error('Нет прав');
  const picker=document.createElement('input');picker.type='file';picker.accept='image/jpeg,image/png,image/webp,image/avif';picker.multiple=true;
  picker.onchange=async()=>{
    if(!picker.files?.length)return;
    let paths=[];
    try{
      const files=safeFiles(picker.files);
      if(!confirm(`Заменить все страницы главы «${c.title}» (${files.length} новых файлов)?`))return;
      for(let i=0;i<files.length;i++){
        toast(`Загружаем новые страницы: ${i+1}/${files.length}`);
        paths.push({chapter_id:c.id,page_number:i+1,storage_path:await uploadOne(files[i],`pages/${c.id}`),byte_size:files[i].size});
      }
      check(await db.from('pages').upsert(paths,{onConflict:'chapter_id,page_number'}));
      check(await db.from('pages').delete().eq('chapter_id',c.id).gt('page_number',files.length));
      const old=c.pages.map(p=>p.storage_path).filter(p=>p.startsWith(`pages/${c.id}/`));
      if(old.length)await db.storage.from('krd-manga').remove([...new Set(old)]);
      await reloadAndRender();toast('Страницы главы заменены ✓');
    }catch(error){
      notifyError(error);
      // При неудаче до обновления базы новая загрузка удаляется администратором вручную, если понадобится.
    }
  };
  picker.click();
}
async function editChapter(v,c){const no=prompt('Номер главы',c.number);if(no===null)return;const title=prompt('Название главы',c.title);if(title===null)return;const summary=prompt('Описание главы',c.summary);if(summary===null)return;check(await db.from('chapters').update({number:Number(no),title:title.trim(),summary}).eq('id',c.id));await reloadAndRender();toast('Глава обновлена')}
async function importDemo(){if(!isAdmin()||state.volumes.length||!confirm('Загрузить демо-каталог: 5 томов, 16 глав и изображения?'))return;const note=$('#adminProgress');try{const mapped={};for(let i=1;i<=12;i++){const file=`assets/pages/page-${String(i).padStart(2,'0')}.jpg`;const blob=await checkFetch(file);const f=new File([blob],`page-${i}.jpg`,{type:'image/jpeg'});mapped[i]=await uploadOne(f,'demo');if(note)note.textContent=`Импорт изображений: ${i}/12`;}for(const v of DATA.volumes){const img=await checkFetch(v.cover);const path=await uploadOne(new File([img],`cover-${v.number}.png`,{type:'image/png'}),'covers');const newVol=check(await db.from('volumes').insert({number:v.number,title:v.title,subtitle:v.subtitle,description:v.description,contents:v.contents,year:v.year,status:v.status,genres:v.genres,cover_path:path}).select('id').single());for(const c of v.chapters){const nc=check(await db.from('chapters').insert({volume_id:newVol.id,number:c.number,title:c.title,summary:c.summary}).select('id').single());check(await db.from('pages').insert(c.pages.map((p,j)=>({chapter_id:nc.id,page_number:j+1,storage_path:mapped[p],byte_size:0}))));}if(note)note.textContent=`Импорт тома ${v.number}/5`;}await reloadAndRender();toast('Демо-каталог импортирован ✓')}catch(e){notifyError(e);toast('Импорт прерван. Уже загруженные данные сохранены. Проверь их в админ-панели.')}}
async function checkFetch(url){const r=await fetch(url);if(!r.ok)throw Error(`Нет файла ${url}`);return r.blob()}
async function login(form){const name=form.querySelector('#loginNick').value,pass=form.querySelector('#loginPass').value,account=state.logins.find(x=>x.username===name);if(!account)throw Error('Выбери никнейм');authMutation=true;try{check(await db.auth.signInWithPassword({email:account.login_email,password:pass}));form.reset();await hydrate();toast('Добро пожаловать, '+name+'!')}finally{authMutation=false}}
async function logout(){authMutation=true;try{audioEl?.pause();clearPrivateCache();await db.auth.signOut();state.user=null;state.profile=null;state.readerKey='';state.volumes=[];state.favorites=new Set();state.progress={};state.ratings=[];await hydrate();location.hash='#/';}finally{authMutation=false}}
let authMutation=false;
let busy=false;
document.addEventListener('submit',async e=>{const form=e.target;if(!['loginForm','commentForm','volumeForm','chapterForm'].includes(form.id))return;e.preventDefault();if(busy)return;busy=true;const submit=form.querySelector('button[type="submit"],button:not([type])');if(submit)submit.disabled=true;try{if(form.id==='loginForm')await login(form);else if(form.id==='commentForm')await submitComment(form);else if(form.id==='volumeForm')await saveVolume(form);else if(form.id==='chapterForm')await saveChapter(form);}catch(error){notifyError(error)}finally{busy=false;if(submit?.isConnected)submit.disabled=false}});
document.addEventListener('input',e=>{if(e.target.id==='catalogSearch'){state.query=e.target.value;const fav=parseRoute().kind==='favorites';$('#volumeGrid').innerHTML=gridHTML(fav);$('#resultCounter').textContent=filtered(fav).length+' томов';}if(e.target.id==='zoomRange')zoom(e.target.value)});
document.addEventListener('change',e=>{if(e.target.id==='soundSelect')playSound(e.target.value).then(()=>{const b=$('[data-action="audio-toggle"]');if(b)b.textContent=audioEl?.paused?'▶':'Ⅱ'})});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action,id=b.dataset.id;try{if(a==='themes'){state.themeOpen=!state.themeOpen;renderHeader()}else if(a==='menu'){state.menuOpen=!state.menuOpen;renderHeader()}else if(a==='theme'){state.theme=id;document.body.dataset.theme=id;setLocal('theme',id);state.themeOpen=false;render(true)}else if(a==='login-screen'){location.hash='#/';await render()}else if(a==='logout')await logout();else if(a==='favorite')await toggleFavorite(id);else if(a==='rate')await rate(id,Number(b.dataset.value));else if(a==='mode'){state.mode=id;setLocal('mode',id);await render();window.scrollTo(0,0)}else if(a==='next-page')changePage(state.page+1);else if(a==='prev-page')changePage(state.page-1);else if(a==='zoom-minus')zoom(state.zoom-10);else if(a==='zoom-plus')zoom(state.zoom+10);else if(a==='audio-toggle'){const a=newAudio();if(a.paused){if(state.ambient==='none')toast('Сначала выбери звук');else await playSound(state.ambient)}else a.pause();b.textContent=a.paused?'▶':'Ⅱ'}else if(a==='delete-comment')await deleteComment(id);else if(a==='delete-volume')await deleteVolume(vol(id));else if(a==='delete-chapter')await deleteChapter(vol(b.dataset.volume),chap(vol(b.dataset.volume),id));else if(a==='edit-chapter')await editChapter(vol(b.dataset.volume),chap(vol(b.dataset.volume),id));else if(a==='replace-pages')await replacePages(chap(vol(b.dataset.volume),id));else if(a==='import-demo')await importDemo();}catch(error){notifyError(error)}});
document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if(parseRoute().kind==='read'&&state.mode==='paged'){if(e.key==='ArrowRight')changePage(state.page+1);if(e.key==='ArrowLeft')changePage(state.page-1)}});
window.addEventListener('hashchange',()=>{state.themeOpen=false;state.menuOpen=false;state.readerKey='';render();window.scrollTo(0,0)});
async function start(){
  renderHeader();renderFooter();
  if(!db){state.loading=false;render();return;}
  // Supabase может присылать SIGNED_IN повторно при возврате к вкладке.
  // Повторное событие для того же пользователя НЕ должно перезагружать сайт.
  db.auth.onAuthStateChange((event,session)=>{
    if(authMutation)return; // Вход и выход обрабатываются явно в login()/logout().
    const nextId=session?.user?.id||null;
    if(event==='SIGNED_IN' && nextId && nextId!==uid()){
      setTimeout(()=>hydrate(),0);
    }else if(event==='SIGNED_OUT' && state.user){
      clearPrivateCache();
      audioEl?.pause();
      state.user=null;state.profile=null;state.readerKey='';state.volumes=[];
      state.comments=[];state.favorites=new Set();state.progress={};state.ratings=[];
      state.loading=false;
      render(); // Сразу скрываем закрытую библиотеку после выхода в другой вкладке.
      setTimeout(()=>hydrate(),0);
    }
  });
  await hydrate({showLoading:true});
}
start();
})();
