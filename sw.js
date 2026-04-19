const CACHE_NAME = 'daesol-el-v10';
// index.html은 캐시하지 않음 — 항상 최신 버전 사용
const STATIC_ASSETS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

const SUPABASE_URL = 'https://bbnmxwpacdfqvicybhau.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 푸시 알림 수신
self.addEventListener('push', event => {
  let data = { title: '대솔이엘', body: '새 고장 신고가 배정되었습니다.' };
  try { data = JSON.parse(event.data.text()); } catch(e) {}

  const isCall = data.type === 'call';

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [300, 150, 300, 150, 300],
      requireInteraction: !isCall,
      data: { reportId: data.reportId || null, type: data.type || null }
    }).then(() => {
      if (isCall) {
        return new Promise(resolve => setTimeout(resolve, 15000)).then(() =>
          self.registration.getNotifications().then(notifications =>
            notifications.forEach(n => { if (n.data?.type === 'call') n.close(); })
          )
        );
      }
    })
  );
});

// 알림 클릭 시 처리중으로 상태 변경 + 신고 내역 탭으로 이동
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const reportId = event.notification.data?.reportId;

  event.waitUntil(
    Promise.all([
      // 처리중으로 상태 변경 (reportId 있을 때만)
      reportId ? fetch(SUPABASE_URL + '/rest/v1/reports?id=eq.' + encodeURIComponent(reportId), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: '처리중', confirmed_at: new Date().toISOString() })
      }).catch(() => {}) : Promise.resolve(),

      // 앱 열기 + 탭 전환
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        if (list.length) {
          list[0].postMessage({ action: 'switchTab', tab: 'list' });
          return list[0].focus();
        }
        return clients.openWindow('./?tab=list');
      })
    ])
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase API — 캐시 안 함
  if (url.hostname.includes('supabase.co')) return;

  // HTML(index.html) — 항상 네트워크에서 가져옴, 실패 시 캐시
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 아이콘, manifest 등 정적 파일 — 캐시 우선
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
