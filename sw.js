const CACHE_NAME = 'daesol-el-v11';
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

  const requireInteraction = data.requireInteraction === true;

  // 같은 건에 대한 반복 알림을 하나로 합침 (전화는 건별로 따로 표시)
  const opts = {
    body: data.body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    image: './icon-512.png',
    vibrate: [500, 200, 500, 200, 500, 200, 500],
    requireInteraction,
    data: { reportId: data.reportId || null, type: data.type || null, siteName: data.siteName || null, phone: data.phone || null, testId: data.testId || null }
  };
  if (isCall) {
    // 전화는 건별로 다 보여야 하므로 합치지 않되, 자동 닫기 때 자기 것만 닫도록 고유 태그를 붙임
    opts.tag = `call-${data.phone || ''}-${Date.now()}`;
  } else if (data.testId) {
    opts.tag = `test-${data.testId}`;   // 알림 테스트도 회차별로 따로 표시
  } else {
    opts.tag = data.reportId
      ? `${data.type || 'report'}-${data.reportId}`
      : `notice-${data.body || data.title || ''}`;
    opts.renotify = true;   // 합쳐질 때도 소리·진동 다시 울림
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, opts).then(() => {
        if (!requireInteraction) {
          return new Promise(resolve => setTimeout(resolve, 40000)).then(() =>
            self.registration.getNotifications({ tag: opts.tag }).then(notifications =>
              notifications.forEach(n => n.close())
            )
          );
        }
      }),
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        list.forEach(client => client.postMessage({ action: 'playSound' }));
      }),
      // 알림 테스트: 도착 시각을 서버에 기록. 앱이 닫혀 있어도 여기는 실행되므로
      // 화면 꺼진 상태에서 실제로 알림이 왔는지, 몇 초 걸렸는지 알 수 있다.
      (data.type === 'push-test' && data.testId)
        ? fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_push_test_received`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_id: data.testId })
          }).catch(() => {})
        : Promise.resolve()
    ])
  );
});

// 알림 클릭 시 처리
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const reportId = event.notification.data?.reportId;
  const type = event.notification.data?.type;
  const isFeedback = type === 'feedback';

  const siteName = event.notification.data?.siteName;
  const phone = event.notification.data?.phone;
  const isCall = type === 'call';
  const isPushTest = type === 'push-test';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (isCall) {
        // 현장 전화 착신: 신고접수 탭으로 이동 + 건물명/전화 자동입력
        const msg = { action: 'fillReport', siteName, phone };
        if (list.length) { list[0].postMessage(msg); return list[0].focus(); }
        return clients.openWindow('./?fillReport=' + encodeURIComponent(siteName) + '&phone=' + encodeURIComponent(phone || ''));
      } else if (isPushTest) {
        // 알림 테스트: 결과 화면을 띄움
        const msg = { action: 'showPushTest' };
        if (list.length) { list[0].postMessage(msg); return list[0].focus(); }
        return clients.openWindow('./?tab=push-test');
      } else if (isFeedback && reportId) {
        // 피드백 미처리: 해당 건 상세 모달로 이동
        const msg = { action: 'openReport', reportId };
        if (list.length) { list[0].postMessage(msg); return list[0].focus(); }
        return clients.openWindow('./?openReport=' + reportId);
      } else {
        // 그 외: 신고내역 탭으로 이동 + 앱에서 처리중 변경
        if (list.length) { list[0].postMessage({ action: 'switchTab', tab: 'list', reportId }); return list[0].focus(); }
        return clients.openWindow('./?tab=list' + (reportId ? '&confirmReport=' + encodeURIComponent(reportId) : ''));
      }
    })
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
